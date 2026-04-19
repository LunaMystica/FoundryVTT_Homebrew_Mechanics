import { endurance, soulstrike, dev, chatLog } from './lib/utils.js';

// ── Settings Registration ──────────────────────────────────────────────────────

Hooks.once('init', () => {
	const settings = [
		{
			key: 'endurance-toggle',
			name: 'Endurance Toggle',
			hint: 'Toggles the automation of the Endurance system.',
			type: Boolean,
			default: true,
		},
		{
			key: 'soulstrike-toggle',
			name: 'Soulstrike Toggle',
			hint: 'Toggles the automation of the Soulstrike system.',
			type: Boolean,
			default: true,
		},
		{
			key: 'debug-toggle',
			name: 'Debug',
			hint: 'Toggles debug mode.',
			type: Boolean,
			default: false,
		},
		{
			key: 'chat-message-toggle',
			name: 'Toggle Chat Messages',
			hint: 'Toggles messages in chat for Soulstrike and Endurance.',
			type: Boolean,
			default: false,
		},
		{
			key: 'hide-messages-toggle',
			name: 'Hide Messages Toggle',
			hint: 'Toggles the hiding of messages in the chat.',
			type: Boolean,
			default: false,
		},
		{
			key: 'soulstrike-item-blacklist',
			name: 'Soulstrike Item Blacklist',
			hint: 'Comma-separated list of item names that should not generate Soulstrike.',
			type: String,
			default: 'Blessed Healer,Flames of Madness',
		},
		{
			key: 'soulstrike-section-blacklist',
			name: 'Soulstrike Section Blacklist',
			hint: 'Comma-separated list of Tidy5e sections that should not generate Soulstrike.',
			type: String,
			default: 'Soulstrike Burst,Weakness Break',
		},
		{
			key: 'force-reload',
			name: 'Force Reload',
			hint: 'Triggers a reload of the game.',
			type: Boolean,
			default: false,
			requiresReload: true,
		},
	];

	for (const { key, requiresReload, ...config } of settings) {
		game.settings.register('xeno-homebrew-mechanics', key, {
			...config,
			scope: 'world',
			config: true,
			requiresReload: requiresReload ?? false,
		});
	}

	console.log('xeno-homebrew-mechanics | Loaded');
});

// ── Global API ─────────────────────────────────────────────────────────────────

Hooks.once('ready', () => {
	globalThis['xenoHomebrewMechanics'] = { endurance, soulstrike, dev, chatLog };
	dev.debugLog('info', 'Global API registered on xenoHomebrewMechanics');
});

// ── Chat Message Visibility ────────────────────────────────────────────────────

Hooks.on('renderChatMessage', (message, [html]) => {
	const shouldHide =
		!game.user.isGM && game.settings.get('xeno-homebrew-mechanics', 'hide-messages-toggle') && message.speaker.alias === 'Homebrew Mechanics';

	if (shouldHide) html.style.display = 'none';
});

// ── MidiQOL Workflow ───────────────────────────────────────────────────────────

Hooks.on('midi-qol.postActiveEffects', async (workflow) => {
	if (!workflow.damageList?.length) return;

	dev.debugGroupStart('Workflow');
	dev.debugWorkflow(workflow);
	dev.debugDamageList(workflow.damageList);

	const enduranceEnabled = game.settings.get('xeno-homebrew-mechanics', 'endurance-toggle');
	const soulstrikeEnabled = game.settings.get('xeno-homebrew-mechanics', 'soulstrike-toggle');

	dev.debugLog('info', `Endurance enabled: ${enduranceEnabled} | Soulstrike enabled: ${soulstrikeEnabled}`);

	if (enduranceEnabled) {
		await endurance.checkEndurance(workflow.damageList, workflow);
	} else {
		dev.debugLog('warning', 'Endurance processing disabled — skipping');
	}

	if (soulstrikeEnabled) {
		await soulstrike.calculateSoulstrike(workflow);
	} else {
		dev.debugLog('warning', 'Soulstrike processing disabled — skipping');
	}

	dev.debugGroupEnd();
});

// ── Combat End Reset ───────────────────────────────────────────────────────────

Hooks.on('deleteCombat', async (combat) => {
	if (!game.user.isGM) return;

	const combatants = [...combat.combatants];

	dev.debugGroupStart('Combat End — Endurance Reset');
	dev.debugLog('info', `Resetting endurance for ${combatants.length} combatant${combatants.length !== 1 ? 's' : ''}`);

	await Promise.all(
		combatants.map(async (combatant) => {
			try {
				await endurance.resetEndurance(combatant.actor);
			} catch (err) {
				dev.debugLog('warning', `Could not reset endurance for ${combatant.actor?.name ?? 'unknown'}: ${err.message}`);
			}
		}),
	);

	dev.debugLog('success', 'Endurance reset complete');
	dev.debugGroupEnd();
});
