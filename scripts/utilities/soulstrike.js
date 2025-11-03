// prettier-ignore
const {utils: {genericUtils}} = chrisPremades;
import { dev } from './dev.js';
import { chatLog } from './chatLog.js';

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

	const newUsesValue = Math.max(sourceItem.system.uses.spent - totalIncrement, 0);
	const initialUsesValue = sourceItem.system.uses.spent;

	dev.debugLog(
		'math',
		`Updating soulstrike: ${sourceItem.system.uses.value} + ${totalIncrement} = ${sourceItem.system.uses.value + totalIncrement} = ${
			sourceItem.system.uses.value + totalIncrement
		} (spent) = ${newUsesValue} (max ${sourceItem.system.uses.max})`
	);

	await genericUtils.update(sourceItem, {
		'system.uses.spent': newUsesValue,
	});

	dev.debugLog('success', `Soulstrike updated successfully`);
	if (newUsesValue !== initialUsesValue) {
		chatMessage.push(
			`<b>${workflow.actor.name}</b>: ${sourceItem.system.uses.value}/${sourceItem.system.uses.max} | (<span style="color:green">+${totalIncrement}</span>)<hr>`
		);
	}

	// Process soulstrike damage taken for each target in damageList
	if (workflow.damageList && workflow.damageList.length > 0) {
		dev.debugLog('process', `Processing soulstrike damage taken for ${workflow.damageList.length} targets`);

		for (const target of workflow.damageList) {
			if (target.hpDamage > 0 && target.isHit) {
				const targetActor = await fromUuid(target.actorUuid);
				if (targetActor) {
					dev.debugLog('target', `Processing damage taken by ${targetActor.name}: ${target.hpDamage} HP damage`);
					await calculateSoulstrikeDamageTaken(targetActor, target.hpDamage, chatMessage);
				} else {
					dev.debugLog('warning', `Could not resolve actor for target UUID: ${target.actorUuid}`);
				}
			} else {
				dev.debugLog('info', `Skipping target with no HP damage: ${target.actorUuid}`);
			}
		}
	} else {
		dev.debugLog('info', 'No damage list available for soulstrike damage taken processing');
	}

	// Send chat messages if any were collected
	if (chatMessage.length > 0) {
		const messageContent = '<h3>Soulstrike:</h3><br>' + chatMessage.join('<br>');
		await chatLog(messageContent);
	}

	dev.debugGroupEnd();
	return;
}

/**
 * Processes soulstrike adjustment when a target actor takes damage.
 * Reduces the target's soulstrike uses based on the damage taken,
 * effectively granting them soulstrike charges when they are hurt.
 *
 * @async
 * @function calculateSoulstrikeDamageTaken
 * @param {Actor} targetActor - The actor that took damage and whose soulstrike will be adjusted
 * @param {number} damageValue - The amount of HP damage taken by the target
 * @param {Array<string>} [chatMessage] - Optional array to collect chat message strings for display
 *
 * @description
 * This function implements the soulstrike mechanic where actors gain soulstrike charges
 * when they take damage.
 **/
async function calculateSoulstrikeDamageTaken(targetActor, damageValue, chatMessage) {
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
	let initialUsesValue = targetUsesValue;
	dev.debugLog('process', `Initial soulstrike: ${targetItem.system.uses.max - targetUsesValue}`);

	targetUsesValue = Math.min(targetUsesValue, targetItem.system.uses.max);
	dev.debugLog('math', `After min cap: $target.system.uses.max - ${targetUsesValue}`);

	targetUsesValue -= damageValue * 1;
	dev.debugLog('math', `After damage reduction: ${(targetUsesValue, targetItem.system.uses.max - targetUsesValue)}`);
	dev.debugLog('math', `After max cap: ${Math.min((targetUsesValue, targetItem.system.uses.max - targetUsesValue), targetItem.system.uses.max)}`);

	await genericUtils.update(targetItem, {
		'system.uses.spent': targetUsesValue,
	});

	dev.debugLog('success', 'Soulstrike damage adjustment completed');

	// Add message to chat if chatMessage array is provided
	if (chatMessage) {
		if (initialUsesValue != 0)
			chatMessage.push(
				`<b>${targetActor.name}</b>: ${targetItem.system.uses.value}/${targetItem.system.uses.max} | (+<span style="color:green">${damageValue}</span>)`
			);
	}

	dev.debugGroupEnd();
	return;
}

export let soulstrike = { calculateSoulstrike, calculateSoulstrikeDamageTaken };
