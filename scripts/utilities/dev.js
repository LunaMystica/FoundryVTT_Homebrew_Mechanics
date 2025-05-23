// prettier-ignore
const {DialogApp, Crosshairs, Summons, Teleport, utils: {actorUtils, activityUtils, animationUtils, combatUtils, compendiumUtils, constants, crosshairUtils, dialogUtils, effectUtils, errors, genericUtils, itemUtils, rollUtils, socketUtils, templateUtils, tokenUtils, workflowUtils, spellUtils, regionUtils}} = chrisPremades;

const debug = true;

async function createChatMessage(messageContent) {
	await ChatMessage.create({
		content: messageContent,
		speaker: ChatMessage.getSpeaker(),
	});
}

export const dev = { createChatMessage };
