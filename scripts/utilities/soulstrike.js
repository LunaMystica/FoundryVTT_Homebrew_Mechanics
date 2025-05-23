// prettier-ignore
const {utils: {genericUtils}} = chrisPremades;

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
async function calculateSoulstrike(workflow) {
	const sourceItem = workflow.actor.items.getName('Soulstrike');
	if (!sourceItem) return;

	let totalIncrement = 0;
	const itemBlacklist = new Set(['Blessed Healer', 'Flames of Madness']);
	const sectionsBlacklist = new Set(['Soulstrike Burst']);

	const { name: itemName, flags } = workflow.item;
	const itemSection = flags['tidy5e-sheet']?.section;

	if (!itemBlacklist.has(itemName) && !sectionsBlacklist.has(itemSection)) {
		totalIncrement = workflow.hitTargets.length * 5;
	}

	const newUsesValue = Math.max(
		sourceItem.system.uses.spent - totalIncrement,
		0
	);
	await genericUtils.update(sourceItem, {
		'system.uses.spent': newUsesValue,
	});

	const updatePromises = workflow.damageList.map(async (target) => {
		const targetActor = await fromUuid(target.actorUuid);
		const targetItem = targetActor.items.getName('Soulstrike');
		if (!targetItem || target.hpDamage <= 0) return;

		const newTargetUsesValue =
			targetItem.system.uses.spent - target.hpDamage * 2;
		await genericUtils.update(targetItem, {
			'system.uses.spent': newTargetUsesValue,
		});

		return ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor: targetActor }),
			content: `${targetActor.name} has gained ${
				target.hpDamage * 2
			} Soulstrike uses.`,
		});
	});

	await Promise.all(updatePromises);
}

export let soulstrike = { calculateSoulstrike };
