import { endurance } from './lib/utils.js';
import { soulstrike } from './lib/utils.js';

Hooks.once('init', async function () {
	game.settings.register('homebrew-mechanics', 'endurance-toggle', {
		name: 'Endurance Toggle',
		hint: 'Toggles the automation of the Endurance system.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: true,
		requiresReload: false,
		filePicker: 'any',
	});
	game.settings.register('homebrew-mechanics', 'soulstrike-toggle', {
		name: 'Soulstrike Toggle',
		hint: 'Toggles the automation of the Soulstrike system.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: true,
		requiresReload: false,
		filePicker: 'any',
	});
	game.settings.register('homebrew-mechanics', 'debug', {
		name: 'Debug',
		hint: 'Toggles debug mode.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: false,
		requiresReload: false,
		filePicker: 'any',
	});
	game.settings.register('homebrew-mechanics', 'debug-chat', {
		name: 'Debug Chat Messages',
		hint: 'Toggles debug chat messages instead of console log.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: false,
		requiresReload: false,
		filePicker: 'any',
	});
});

Hooks.once('ready', async function () {
	console.log(game.i18n.localize('MODULE.hello'));
});

Hooks.on('midi-qol.RollComplete', async (workflow) => {
	const { hitTargets } = workflow;
	console.log(hitTargets);
	if (hitTargets.length === 0) return;

	if (game.settings.get('homebrew-mechanics', 'endurance-toggle')) {
		await endurance.checkEndurance(hitTargets, workflow);
	}

	if (game.settings.get('homebrew-mechanics', 'soulstrike-toggle')) {
		console.log(workflow);
		await soulstrike.calculateSoulstrike(workflow);
	}
});
