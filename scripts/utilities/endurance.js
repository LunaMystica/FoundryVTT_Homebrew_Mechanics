const {
	utils: { activityUtils, effectUtils, genericUtils, workflowUtils },
} = chrisPremades;
import { damageTypeFeatures } from '../../constants/damageTypeFeatures.js';
import { endurance_broken_effect } from '../../constants/effects.js';
import { dev } from './dev.js';

let chatMessages = [];

/**
 * Iterate over the hit targets and for each, update its Endurance, if appropriate.
 * If any of them are broken, create synthetic activity data rolls for each broken
 * target and damage type.
 * @param {Array<Combatant>} damageList
 *   The list of combatants that were hit by the workflow.
 * @param {Workflow} workflow
 *   The workflow that hit the combatants.
 */
async function checkEndurance(damageList, workflow) {
	chatMessages = ['<h3>Endurance:</h3>'];

	let brokenTargets = [];
	for (const target of damageList) {
		if (target.tempDamage + target.hpDamage <= 0) continue;
		brokenTargets = await updateEndurance(target, workflow, brokenTargets);
	}
	if (chatMessages.length > 1) {
		const chatMessage = chatMessages.join('<br>');

		await dev.log(chatMessage);
	}
	if (!brokenTargets || brokenTargets.length === 0) {
		return;
	}
	await processBrokenTargets(brokenTargets, workflow, damageTypeFeatures);

	return;
}

async function updateEndurance(target, workflow, brokenTargets = []) {
	const targetActor = await fromUuid(target.actorUuid);
	const enduranceReduction = await calculateEnduranceReduction(workflow.item);

	if (enduranceReduction === 0) return brokenTargets;

	const weaknesses = new Set(targetActor.system.traits.dv.value);
	if (!weaknesses.size) return brokenTargets;

	const enduranceItem = targetActor.items.getName('Endurance');
	if (!enduranceItem || enduranceItem.system.uses.spent >= enduranceItem.system.uses.max) return brokenTargets;

	let simulatedEndurance = enduranceItem.system.uses.spent;
	let enduranceBroken = false;

	for (const damage of workflow.damageRolls) {
		if (!weaknesses.has(damage.options.type)) continue;
		let tokenTarget = await fromUuid(target.targetUuid);

		simulatedEndurance += enduranceReduction;
		if (simulatedEndurance >= enduranceItem.system.uses.max) {
			simulatedEndurance = enduranceItem.system.uses.max;
			enduranceBroken = true;

			const targetToken = canvas.tokens.get(tokenTarget.id);
			brokenTargets.push({ target: targetToken, damageType: damage.options.type });
			await effectUtils.createEffect(targetActor, endurance_broken_effect);
		}

		await genericUtils.update(enduranceItem, {
			'system.uses.spent': simulatedEndurance,
		});

		chatMessages.push(
			`<b>${tokenTarget.name}</b>: ${enduranceItem.system.uses.value}/${enduranceItem.system.uses.max} | (<span style="color:red">-${enduranceReduction}</span>) | ${damage.options.type}` +
				(enduranceBroken ? ' (broken)' : ''),
		);
		break;
	}

	return brokenTargets;
}

/**
 * Calculate the Endurance reduction for a given item.
 * @param {Item} item
 * @return {number} The Endurance reduction for the given item.
 */
async function calculateEnduranceReduction(item) {
	let reduction = 0;

	switch (item.type) {
		case 'weapon':
			reduction = 20;
			break;
		case 'spell':
			if (item.name === 'Elemental Bullet' || item.name === 'Sacred Bolt') {
				reduction = 5;
			} else {
				reduction = 40;
			}
			break;
		case 'feat':
			const { section } = item.flags['tidy5e-sheet'] ?? {};
			if (section === 'Soulstrike Move') {
				reduction = 40;
			} else if (section === 'Soulstrike Burst') {
				reduction = 80;
			}
			break;
		default:
	}

	return reduction;
}

/**
 * @param {Combatant} target
 * @param {Workflow} workflow
 * @return {Promise<void>}
 */

/**
 * Process broken targets by creating synthetic activity data rolls
 * for each target.
 * @param {Array<{target: Combatant, damageType: string}>} brokenTargets
 *   The list of broken targets.
 * @param {Workflow} workflow
 *   The workflow that caused the broken targets.
 * @param {Object<string, string>} damageTypeFeatures
 *   A mapping from damage type to the UUID of the feature that caused it.
 */
async function processBrokenTargets(brokenTargets, workflow, damageTypeFeatures) {
	const groupedBrokenTargets = brokenTargets.reduce((acc, { target, damageType }) => {
		if (!acc[damageType]) {
			acc[damageType] = [];
		}
		acc[damageType].push(target);
		return acc;
	}, {});

	for (const [damageType, targets] of Object.entries(groupedBrokenTargets)) {
		const sourceItem = await fromUuid(damageTypeFeatures[damageType]);
		const totalDamage = workflow.damageRolls.filter((damage) => damage.options.type === damageType).reduce((acc, damage) => acc + damage.total, 0);
		const activity = sourceItem.system.activities.values().next().value;
		const activityData = await activityUtils.withChangedDamage(activity, `${totalDamage}`);

		await workflowUtils.syntheticActivityDataRoll(activityData, sourceItem, workflow.actor, targets);
	}

	return;
}

/**
 * Reset an actor's Endurance to 0.
 * @param {Actor} actor
 *   The actor whose Endurance should be reset.
 */
async function resetEndurance(actor) {
	const item = actor.items.getName('Endurance');

	if (!item) return;
	await genericUtils.update(item, { 'system.uses.spent': 0 });
}

export let endurance = {
	checkEndurance,
	updateEndurance,
	calculateEnduranceReduction,
	processBrokenTargets,
	resetEndurance,
};
