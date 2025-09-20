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

	dev.debugGroupStart('Endurance Processing');
	dev.debugLog('info', `Processing ${damageList.length} damage targets`);

	let brokenTargets = [];
	for (const target of damageList) {
		const totalDamage = target.tempDamage + target.hpDamage;
		dev.debugLog('target', `Checking target: ${target.actor?.name} (Damage: ${totalDamage})`);
		
		if (totalDamage <= 0) {
			dev.debugLog('warning', 'Skipping target - no damage taken');
			continue;
		}
		brokenTargets = await updateEndurance(target, workflow, brokenTargets);
	}
	
	dev.debugLog('info', `Processing complete. Broken targets: ${brokenTargets.length}`);
	
	if (chatMessages.length > 1) {
		const chatMessage = chatMessages.join('<br>');
		await dev.log(chatMessage);
	}
	
	if (!brokenTargets || brokenTargets.length === 0) {
		dev.debugLog('success', 'No broken targets to process');
		dev.debugGroupEnd();
		return;
	}
	
	dev.debugLog('process', 'Processing broken targets for additional damage');
	await processBrokenTargets(brokenTargets, workflow, damageTypeFeatures);

	dev.debugGroupEnd();
	return;
}

async function updateEndurance(target, workflow, brokenTargets = []) {
	const targetActor = await fromUuid(target.actorUuid);
	const enduranceReduction = await calculateEnduranceReduction(workflow.item);

	dev.debugLog('process', `Updating endurance for ${targetActor.name}`);
	dev.debugLog('math', `Endurance reduction calculated: ${enduranceReduction}`);

	if (enduranceReduction === 0) {
		dev.debugLog('warning', 'No endurance reduction - skipping target');
		return brokenTargets;
	}

	const weaknesses = new Set(targetActor.system.traits.dv.value);
	dev.debugLog('info', `Target weaknesses: [${Array.from(weaknesses).join(', ')}]`);
	
	if (!weaknesses.size) {
		dev.debugLog('warning', 'Target has no weaknesses - skipping');
		return brokenTargets;
	}

	const enduranceItem = targetActor.items.getName('Endurance');
	if (!enduranceItem) {
		dev.debugLog('warning', 'Target has no Endurance item - skipping');
		return brokenTargets;
	}
	
	if (enduranceItem.system.uses.spent >= enduranceItem.system.uses.max) {
		dev.debugLog('warning', 'Target endurance already broken - skipping');
		return brokenTargets;
	}

	dev.debugLog('info', `Current endurance: ${enduranceItem.system.uses.value}/${enduranceItem.system.uses.max}`);

	let simulatedEndurance = enduranceItem.system.uses.spent;
	let enduranceBroken = false;

	for (const damage of workflow.damageRolls) {
		dev.debugLog('process', `Checking damage type: ${damage.options.type} (${damage.total} damage)`);
		
		if (!weaknesses.has(damage.options.type)) {
			dev.debugLog('info', 'Damage type not in weaknesses - continuing');
			continue;
		}
		
		dev.debugLog('success', `Weakness match found: ${damage.options.type}`);
		let tokenTarget = await fromUuid(target.targetUuid);

		simulatedEndurance += enduranceReduction;
		dev.debugLog('math', `New simulated endurance: ${simulatedEndurance}/${enduranceItem.system.uses.max}`);
		
		if (simulatedEndurance >= enduranceItem.system.uses.max) {
			simulatedEndurance = enduranceItem.system.uses.max;
			enduranceBroken = true;
			dev.debugLog('error', 'ENDURANCE BROKEN!');

			const targetToken = canvas.tokens.get(tokenTarget.id);
			brokenTargets.push({ target: targetToken, damageType: damage.options.type });
			dev.debugLog('update', 'Applied broken endurance effect');
			await effectUtils.createEffect(targetActor, endurance_broken_effect);
		}

		dev.debugLog('update', `Updating endurance item to ${simulatedEndurance} spent`);
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

	dev.debugLog('math', `Calculating endurance reduction for: ${item.name} (Type: ${item.type})`);

	switch (item.type) {
		case 'weapon':
			reduction = 20;
			dev.debugLog('math', 'Weapon type - applying 20 reduction');
			break;
		case 'spell':
			if (item.name === 'Elemental Bullet' || item.name === 'Sacred Bolt') {
				reduction = 5;
				dev.debugLog('math', 'Special spell - applying 5 reduction');
			} else {
				reduction = 40;
				dev.debugLog('math', 'Standard spell - applying 40 reduction');
			}
			break;
		// TODO: Add general support for feats
		case 'feat':
			const { section } = item.flags['tidy5e-sheet'] ?? {};
			dev.debugLog('info', `Feat section: ${section}`);
			if (section === 'Soulstrike Move') {
				reduction = 40;
				dev.debugLog('math', 'Soulstrike Move - applying 40 reduction');
			} else if (section === 'Soulstrike Burst') {
				reduction = 80;
				dev.debugLog('math', 'Soulstrike Burst - applying 80 reduction');
			} else {
				dev.debugLog('warning', 'Unknown feat section - no reduction');
			}
			break;
		default:
			dev.debugLog('warning', 'Unknown item type - no reduction');
	}

	dev.debugLog('success', `Final endurance reduction: ${reduction}`);
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
	dev.debugGroupStart('Processing Broken Targets');

	const groupedBrokenTargets = brokenTargets.reduce((acc, { target, damageType }) => {
		if (!acc[damageType]) {
			acc[damageType] = [];
		}
		acc[damageType].push(target);
		return acc;
	}, {});

	dev.debugLog('info', 'Grouped broken targets by damage type:', groupedBrokenTargets);

	for (const [damageType, targets] of Object.entries(groupedBrokenTargets)) {
		dev.debugLog('process', `Processing ${targets.length} targets for ${damageType} damage`);
		
		const sourceItem = await fromUuid(damageTypeFeatures[damageType]);
		if (!sourceItem) {
			dev.debugLog('error', `No source item found for damage type: ${damageType}`);
			continue;
		}
		
		dev.debugLog('info', `Using source item: ${sourceItem.name}`);
		
		const totalDamage = workflow.damageRolls.filter((damage) => damage.options.type === damageType).reduce((acc, damage) => acc + damage.total, 0);
		dev.debugLog('math', `Total ${damageType} damage: ${totalDamage}`);
		
		const activity = sourceItem.system.activities.values().next().value;
		const activityData = await activityUtils.withChangedDamage(activity, `${totalDamage}`);

		dev.debugLog('process', 'Creating synthetic activity roll for broken endurance effect');
		await workflowUtils.syntheticActivityDataRoll(activityData, sourceItem, workflow.actor, targets);
		dev.debugLog('success', 'Synthetic activity roll completed');
	}

	dev.debugGroupEnd();
	return;
}

/**
 * Reset an actor's Endurance to 0.
 * @param {Actor} actor
 *   The actor whose Endurance should be reset.
 */
async function resetEndurance(actor) {
	const item = actor.items.getName('Endurance');

	if (!item) {
		dev.debugLog('warning', `${actor.name} has no Endurance item to reset`);
		return;
	}
	
	dev.debugLog('update', `Resetting ${actor.name}'s endurance from ${item.system.uses.spent} to 0`);
	await genericUtils.update(item, { 'system.uses.spent': 0 });
	dev.debugLog('success', `Endurance reset complete for ${actor.name}`);
}

export let endurance = {
	checkEndurance,
	updateEndurance,
	calculateEnduranceReduction,
	processBrokenTargets,
	resetEndurance,
};
