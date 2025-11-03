const {
	utils: { activityUtils, effectUtils, genericUtils, workflowUtils },
} = chrisPremades;
import { damageTypeFeatures } from '../../constants/damageTypeFeatures.js';
import { endurance_broken_effect } from '../../constants/effects.js';
import { dev } from './dev.js';
import { chatLog } from './chatLog.js';

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
		const targetActor = await fromUuid(target.actorUuid);
		dev.debugLog('target', `Checking target: ${targetActor.name} (Damage: ${target.hpDamage})`);

		if (!target.isHit || workflow.activity.damage.onSave === 'none') {
			dev.debugLog('warning', 'Skipping target - no hit');
			continue;
		}
		brokenTargets = await updateEndurance(targetActor, target, workflow, brokenTargets);
	}

	dev.debugLog('info', `Processing complete. Broken targets: ${brokenTargets.length}`);

	if (chatMessages.length > 1) {
		const chatMessage = chatMessages.join('<br>');
		await chatLog(chatMessage);
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

/**
 * Updates endurance for a target actor based on damage taken.
 * Processes weakness-based damage and handles endurance breaking.
 *
 * @param {Actor} targetActor - The actor whose endurance will be updated
 * @param {Object} target - The damage target object from the workflow
 * @param {Workflow} workflow - The MidiQOL workflow containing damage information
 * @param {Array} brokenTargets - Array of previously broken targets
 * @returns {Promise<Array>} Updated array of broken targets
 */
async function updateEndurance(targetActor, target, workflow, brokenTargets = []) {
	const enduranceReduction = await calculateEnduranceReduction(workflow.item);

	dev.debugLog('process', `Updating endurance for ${targetActor.name}`);
	dev.debugLog('math', `Endurance reduction calculated: ${enduranceReduction}`);

	// Early returns for invalid scenarios
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

	// Get the actual token object for broken target tracking
	const targetTokenDocument = await fromUuid(target.targetUuid);
	const targetToken = canvas.tokens.get(targetTokenDocument.id);

	// Process damage types to find weakness matches
	for (const damage of workflow.damageRolls) {
		dev.debugLog('process', `Checking damage type: ${damage.options.type} (${damage.total} damage)`);

		if (!weaknesses.has(damage.options.type)) {
			dev.debugLog('info', 'Damage type not in weaknesses - continuing');
			continue;
		}

		dev.debugLog('success', `Weakness match found: ${damage.options.type}`);

		// Calculate new endurance value
		let newEnduranceSpent = enduranceItem.system.uses.spent + enduranceReduction;
		let enduranceBroken = false;

		if (newEnduranceSpent >= enduranceItem.system.uses.max) {
			newEnduranceSpent = enduranceItem.system.uses.max;
			enduranceBroken = true;
			dev.debugLog('error', 'ENDURANCE BROKEN!');

			// Add to broken targets and apply effect
			brokenTargets.push({ target: targetToken, damageType: damage.options.type });
			await effectUtils.createEffect(targetActor, endurance_broken_effect);
			dev.debugLog('update', 'Applied broken endurance effect');
		}

		// Update the endurance item
		dev.debugLog('update', `Updating endurance item: ${enduranceItem.system.uses.spent} → ${newEnduranceSpent} spent`);
		await genericUtils.update(enduranceItem, {
			'system.uses.spent': newEnduranceSpent,
		});

		// Add chat message
		const enduranceStatus = `${enduranceItem.system.uses.max - newEnduranceSpent}/${enduranceItem.system.uses.max}`;
		chatMessages.push(
			`<b>${targetActor.name}</b>: ${enduranceStatus} | (<span style="color:red">-${enduranceReduction}</span>) | ${damage.options.type}` +
				(enduranceBroken ? ' <strong>(BROKEN)</strong>' : ''),
		);

		// Only process the first weakness match
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
		case 'feat':
			const { section } = item.flags['tidy5e-sheet'] ?? {};
			dev.debugLog('info', `Feat section: ${section}`);
			if (section === 'Soulstrike Move') {
				reduction = 40;
				dev.debugLog('math', 'Soulstrike Move - applying 40 reduction');
			} else if (section === 'Soulstrike Burst') {
				reduction = 80;
				dev.debugLog('math', 'Soulstrike Burst - applying 80 reduction');
			} else if (section === 'Weakness Break') {
				dev.debugLog('warning', 'Weakness Break - no reduction');
			} else {
				reduction = 40;
				dev.debugLog('warning', 'Unknown feat section - applying 40 reduction');
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

		dev.debugLog('info', 'Activity data:', activityData);

		if (!activityData) {
			dev.debugLog('warning', 'No activity data found for source item');
			continue;
		} else {
			activityData.target.affects.count = 999;
			dev.debugLog('info', 'Modified activity data:', activityData);
		}

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
