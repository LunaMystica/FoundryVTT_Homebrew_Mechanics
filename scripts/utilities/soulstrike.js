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

	if (sourceItem) {
		chatMessage = []
		let totalIncrement = 0;

		const itemBlacklist = new Set(['Blessed Healer', 'Flames of Madness']);
		const sectionsBlacklist = new Set(['Soulstrike Burst', 'Weakness Break']);

		let { name: itemName, flags } = workflow.item;
		let itemSection = flags['tidy5e-sheet']?.section;

		itemName = itemName.trimEnd();
		itemSection = itemSection?.trimEnd();

		if (workflow.hitTargets.size <= 0) return;

		if (!itemBlacklist.has(itemName) || !sectionsBlacklist.has(itemSection)) {
			totalIncrement = workflow.hitTargets.size * 5;
		}

		if (totalIncrement <= 0 || isNaN(totalIncrement)) return;

		const newUsesValue = Math.max(sourceItem.system.uses.spent - totalIncrement, 0);

		await genericUtils.update(sourceItem, {
			'system.uses.spent': newUsesValue,
		});

		chatMessages.push(
			`<b>${workflow.actor.name}</b>: ${sourceItem.system.uses.value}/${sourceItem.system.uses.max} | (<span style="color:green">+${totalIncrement}</span>)<hr>`,
		);
	}
	return
}

async function calculateSoulstrikeDamageTaken(targetActor, damageValue, MidiObject, chatMessage){
	
		const targetItem = targetActor.items.getName('Soulstrike');
		if (!targetItem || damageValue <= 0) return;

		let targetUsesValue = targetItem.system.uses.spent;

		targetUsesValue = Math.min(targetUsesValue, targetItem.system.uses.max);
		targetUsesValue -= damageValue * 1;

		await genericUtils.update(targetItem, {
			'system.uses.spent': targetUsesValue,
		});

		chatMessages.push(
			`<b>${targetActor.name}</b>: ${targetItem.system.uses.value}/${targetItem.system.uses.max} | (+<span style="color:green">${
				target.hpDamage * 1
			}</span>)`,
		);


	return;
}

export let soulstrike = { calculateSoulstrike, calculateSoulstrikeDamageTaken };
