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
		name: 'Debug Chat Messages',
		hint: 'Toggles messages in chat for Soulstrike and Endurance.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: false,
		requiresReload: false,
	});
});

Hooks.on('ready', async () => {
	globalThis['xenoHomebrewMechanics'] = {
		endurance,
		soulstrike,
		dev,
	};
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
