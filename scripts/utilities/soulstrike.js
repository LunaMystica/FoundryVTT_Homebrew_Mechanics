// prettier-ignore
const {utils: {genericUtils}} = chrisPremades;
import { dev } from './dev.js';

/**
 * Iterate over the hit targets and for each, calculate the
 * appropriate number of Soulstrike uses to grant to the
 * actor, and update the actor's Soulstrike item. If the
 * actor does not have a Soulstrike item, do not update
 * anything.
 *
 * @param {Workflow} workflow
 *   The workflow that hit the combatants.
 */
async function calculateSoulstrike(workflow, chatMessage) {
	let chatMessages = ['<h3>Soulstrike:</h3>'];
	const sourceItem = workflow.actor.items.getName('Soulstrike');

	dev.debugGroupStart('Soulstrike Processing');
	dev.debugLog('info', `Processing soulstrike for actor: ${workflow.actor.name}`);

	if (!sourceItem) {
		dev.debugLog('warning', 'Actor has no Soulstrike item - skipping');
		dev.debugGroupEnd();
		return;
	}

	dev.debugLog('info', `Current soulstrike: ${sourceItem.system.uses.value}/${sourceItem.system.uses.max}`);

	chatMessage = [];
	let totalIncrement = 0;

	const itemBlacklist = new Set(['Blessed Healer', 'Flames of Madness']);
	const sectionsBlacklist = new Set(['Soulstrike Burst', 'Weakness Break']);

	dev.debugLog('info', `Item blacklist: [${Array.from(itemBlacklist).join(', ')}]`);
	dev.debugLog('info', `Section blacklist: [${Array.from(sectionsBlacklist).join(', ')}]`);

	let { name: itemName, flags } = workflow.item;
	let itemSection = flags['tidy5e-sheet']?.section;

	itemName = itemName.trimEnd();
	itemSection = itemSection?.trimEnd();

	dev.debugLog('process', `Checking item: "${itemName}" (Section: "${itemSection}")`);

	if (workflow.hitTargets.size <= 0) {
		dev.debugLog('warning', 'No hit targets - no soulstrike gain');
		dev.debugGroupEnd();
		return;
	}

	dev.debugLog('info', `Hit targets: ${workflow.hitTargets.size}`);

	// Check blacklists - note the logic uses OR, not AND
	const itemBlacklisted = itemBlacklist.has(itemName);
	const sectionBlacklisted = sectionsBlacklist.has(itemSection);

	dev.debugLog('process', `Item blacklisted: ${itemBlacklisted}`);
	dev.debugLog('process', `Section blacklisted: ${sectionBlacklisted}`);

	if (!itemBlacklisted && !sectionBlacklisted) {
		totalIncrement = workflow.hitTargets.size * 5;
		dev.debugLog('math', `Calculating increment: ${workflow.hitTargets.size} targets × 5 = ${totalIncrement}`);
	} else {
		dev.debugLog('warning', 'Item or section is blacklisted - no soulstrike gain');
	}

	if (totalIncrement <= 0 || isNaN(totalIncrement)) {
		dev.debugLog('warning', 'No valid increment calculated');
		dev.debugGroupEnd();
		return;
	}

	const oldUsesSpent = sourceItem.system.uses.spent;
	const newUsesValue = Math.max(sourceItem.system.uses.spent - totalIncrement, 0);

	dev.debugLog('math', `Updating soulstrike: ${oldUsesSpent} - ${totalIncrement} = ${newUsesValue} (min 0)`);

	await genericUtils.update(sourceItem, {
		'system.uses.spent': newUsesValue,
	});

	dev.debugLog('success', `Soulstrike updated successfully`);

	chatMessages.push(
		`<b>${workflow.actor.name}</b>: ${sourceItem.system.uses.value}/${sourceItem.system.uses.max} | (<span style="color:green">+${totalIncrement}</span>)<hr>`,
	);

	dev.debugGroupEnd();
	return;
}

async function calculateSoulstrikeDamageTaken(targetActor, damageValue, MidiObject, chatMessage){

	dev.debugGroupStart('Soulstrike Damage Taken');
	dev.debugLog('info', `Processing damage taken for: ${targetActor.name}`);
	dev.debugLog('info', `Damage value: ${damageValue}`);

	const targetItem = targetActor.items.getName('Soulstrike');
	if (!targetItem) {
		dev.debugLog('warning', 'Target has no Soulstrike item - skipping');
		dev.debugGroupEnd();
		return;
	}

	if (damageValue <= 0) {
		dev.debugLog('warning', 'No damage taken - skipping soulstrike adjustment');
		dev.debugGroupEnd();
		return;
	}

	dev.debugLog('info', `Current soulstrike: ${targetItem.system.uses.value}/${targetItem.system.uses.max}`);

	let targetUsesValue = targetItem.system.uses.spent;
	dev.debugLog('process', `Initial uses spent: ${targetUsesValue}`);

	// Note: This line seems incorrect in original code - should probably be Math.max not Math.min
	targetUsesValue = Math.min(targetUsesValue, targetItem.system.uses.max);
	dev.debugLog('math', `After min cap: ${targetUsesValue}`);

	targetUsesValue -= damageValue * 1;
	dev.debugLog('math', `After damage reduction: ${targetUsesValue}`);

	await genericUtils.update(targetItem, {
		'system.uses.spent': targetUsesValue,
	});

	dev.debugLog('success', 'Soulstrike damage adjustment completed');

	// Note: There's a bug in the original code - 'target' is not defined here
	// It should probably use damageValue instead of target.hpDamage
	chatMessages.push(
		`<b>${targetActor.name}</b>: ${targetItem.system.uses.value}/${targetItem.system.uses.max} | (+<span style="color:green">${damageValue}</span>)`,
	);

	dev.debugGroupEnd();
	return;
}

export let soulstrike = { calculateSoulstrike, calculateSoulstrikeDamageTaken };
