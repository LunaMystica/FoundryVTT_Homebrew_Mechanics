import { endurance } from './lib/utils.js';
import { soulstrike } from './lib/utils.js';
import { dev } from './lib/utils.js';

Hooks.once('init', async function () {
	game.settings.register('xeno-homebrew-mechanics', 'endurance-toggle', {
		name: 'Endurance Toggle',
		hint: 'Toggles the automation of the Endurance system.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: true,
		requiresReload: false,
	});
	game.settings.register('xeno-homebrew-mechanics', 'soulstrike-toggle', {
		name: 'Soulstrike Toggle',
		hint: 'Toggles the automation of the Soulstrike system.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: true,
		requiresReload: false,
	});
	game.settings.register('xeno-homebrew-mechanics', 'debug-toggle', {
		name: 'Debug',
		hint: 'Toggles debug mode.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: false,
		requiresReload: false,
	});
	game.settings.register('xeno-homebrew-mechanics', 'chat-message-toggle', {
		name: 'Toggle Chat Messages',
		hint: 'Toggles messages in chat for Soulstrike and Endurance.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: false,
		requiresReload: false,
	});
	game.settings.register('xeno-homebrew-mechanics', 'hide-messages-toggle', {
		name: 'Hide Messages Toggle',
		hint: 'Toggles the hiding of messages in the chat.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: false,
		requiresReload: false,
	});
	game.settings.register('xeno-homebrew-mechanics', 'force-reload', {
		name: 'Force Reload',
		hint: 'Triggers a reload of the game.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: false,
		requiresReload: true,
	});
	console.log('xeno-homebrew-mechanics | Loaded');
});

Hooks.on('ready', async () => {
	globalThis['xenoHomebrewMechanics'] = {
		endurance,
		soulstrike,
		dev,
	};
});

Hooks.on('renderChatMessage', (message, [html]) => {
	if (!game.user.isGM && game.settings.get('xeno-homebrew-mechanics', 'hide-messages-toggle') && message.speaker.alias === 'Homebrew Mechanics')
		html.style.display = 'none';
});

Hooks.on('midi-qol.RollComplete', async (workflow) => {
	await new Promise((resolve) => setTimeout(resolve, 1000));

	const hitTargets = workflow.hitTargets;
	if (hitTargets.size <= 0) return;

	if (game.settings.get('xeno-homebrew-mechanics', 'endurance-toggle')) {
		await endurance.checkEndurance(hitTargets, workflow);
	}

	if (game.settings.get('xeno-homebrew-mechanics', 'soulstrike-toggle')) {
		await soulstrike.calculateSoulstrike(workflow);
	}
});
