const {
	utils: { activityUtils, effectUtils, genericUtils, workflowUtils },
} = chrisPremades;
import { damageTypeFeatures } from '../../constants/damageTypeFeatures.js';
import { endurance_broken_effect } from '../../constants/effects.js';
import { createChatMessage } from './dev.js';

const debug = game.settings.get('homebrew-mechanics', 'debug');
const chatDebug = game.settings.get('homebrew-mechanics', 'debug-chat');

/**
 * Iterate over the hit targets and for each, update its Endurance, if appropriate.
 * If any of them are broken, create synthetic activity data rolls for each broken
 * target and damage type.
 * @param {Array<Combatant>} hitTargets
 *   The list of combatants that were hit by the workflow.
 * @param {Workflow} workflow
 *   The workflow that hit the combatants.
 */
async function checkEndurance(hitTargets, workflow) {
	let brokenTargets = [];
	for (const target of hitTargets) {
		brokenTargets = await updateEndurance(target, workflow, brokenTargets);
	}

	if (!brokenTargets || brokenTargets.length === 0) {
		return;
	}

	await processBrokenTargets(brokenTargets, workflow, damageTypeFeatures);
}

async function updateEndurance(target, workflow, brokenTargets = []) {
	const targetActor = target.actor;
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

		simulatedEndurance += enduranceReduction;
		if (simulatedEndurance > enduranceItem.system.uses.max) {
			simulatedEndurance = enduranceItem.system.uses.max;
			enduranceBroken = true;
			brokenTargets.push({ target, damageType: damage.options.type });
			await effectUtils.createEffect(targetActor, endurance_broken_effect);
		}

		await genericUtils.update(enduranceItem, {
			'system.uses.spent': simulatedEndurance,
		});

		break;
	}

	if (debug) {
		if (chatDebug) {
			await createChatMessage(`${target.name} endurance: ${enduranceItem.system.uses.spent}/${enduranceItem.system.uses.max}`);
		} else {
			console.log(`${target.name} endurance: ${enduranceItem.system.uses.spent}/${enduranceItem.system.uses.max}`);
		}
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

		let activity = sourceItem.system.activities.values().next().value;

		let activityData = await activityUtils.withChangedDamage(activity, `${totalDamage}`);

		await workflowUtils.syntheticActivityDataRoll(activityData, sourceItem, workflow.actor, targets);
	}
}

export let endurance = {
	checkEndurance,
	updateEndurance,
	calculateEnduranceReduction,
	processBrokenTargets,
};
