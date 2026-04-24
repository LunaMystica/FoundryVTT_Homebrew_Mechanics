import { endurance, soul, dev, chatLog } from './lib/utils.js';
import { EnduranceBreakConfig } from './apps/enduranceBreakConfig.js';
import { damageTypeFeatures } from '../constants/index.js';

// ── Settings Registration ──────────────────────────────────────────────────────

Hooks.once('init', () => {
	game.settings.registerMenu('xeno-homebrew-mechanics', 'endurance-damage-items-menu', {
		name: 'Endurance Break Items',
		label: 'Configure',
		hint: 'Configure which item UUID fires the synthetic damage roll for each damage type when Endurance breaks.',
		icon: 'fas fa-bolt',
		type: EnduranceBreakConfig,
		restricted: true,
	});

	game.settings.register('xeno-homebrew-mechanics', 'endurance-damage-items', {
		scope: 'world',
		config: false,
		type: Object,
		default: damageTypeFeatures,
	});

	const settings = [
		{
			key: 'endurance-toggle',
			name: 'Endurance Toggle',
			hint: 'Toggles the automation of the Endurance system.',
			type: Boolean,
			default: true,
		},
		{
			key: 'soul-toggle',
			name: 'Soul Toggle',
			hint: 'Toggles the automation of the Soul system.',
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
			hint: 'Toggles messages in chat for Soul and Endurance.',
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
			key: 'soul-item-blacklist',
			name: 'Soul Item Blacklist',
			hint: 'Comma-separated list of item names that should not generate Soul.',
			type: String,
			default: 'Blessed Healer,Flames of Madness',
		},
		{
			key: 'soul-section-blacklist',
			name: 'Soul Section Blacklist',
			hint: 'Comma-separated list of Tidy5e sections that should not generate Soul.',
			type: String,
			default: 'Soulburst,Weakness Break',
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
	globalThis['xenoHomebrewMechanics'] = { endurance, soul, dev, chatLog };
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
	const enduranceEnabled = game.settings.get('xeno-homebrew-mechanics', 'endurance-toggle');
	const soulEnabled = game.settings.get('xeno-homebrew-mechanics', 'soul-toggle');

	dev.debugGroupStart(`${workflow.actor.name}: ${workflow.item.name} — endurance: ${enduranceEnabled}, soul: ${soulEnabled}`);

	// Stamp lastHit on all targets for damage-less activities (e.g. Magic Missile launcher)
	// so downstream bolt workflows from the same item/activity/turn are de-duplicated.
	if (!workflow.damageList?.length && workflow.targets?.size) {
		const combatRound = game.combat?.round ?? null;
		const combatTurn = game.combat?.turn ?? null;
		await Promise.all(
			[...workflow.targets].map((token) => {
				const tokenDoc = token.document ?? token;
				dev.debugLog('info', `Set lastHit (no damage) for ${tokenDoc.name}`, {
					itemUuid: workflow.item.uuid,
					activityUuid: workflow.activity.uuid,
					round: combatRound,
					turn: combatTurn,
				});
				return tokenDoc.setFlag('xeno-homebrew-mechanics', 'lastHit', {
					itemUuid: workflow.item.uuid,
					activityUuid: workflow.activity.uuid,
					round: combatRound,
					turn: combatTurn,
				});
			}),
		);
	}

	if (!workflow.damageList?.length) return;

	dev.debugWorkflow(workflow);
	dev.debugDamageList(workflow.damageList);

	const sections = [];

	if (enduranceEnabled) {
		const s = await endurance.checkEndurance(workflow.damageList, workflow);
		if (s) sections.push(s);
	} else {
		dev.debugLog('warning', 'Endurance processing disabled — skipping');
	}

	if (soulEnabled) {
		const s = await soul.calculateSoul(workflow);
		if (s) sections.push(s);
	} else {
		dev.debugLog('warning', 'Soul processing disabled — skipping');
	}

	if (sections.length > 0) {
		await chatLog.send(`<div class="hbm-card">${sections.join('<hr class="hbm-divider">')}</div>`);
	}

	dev.debugGroupEnd();
});

// ── Long Rest Reset ────────────────────────────────────────────────────────────

Hooks.on('dnd5e.longRest', async (actor) => {
	if (!game.user.isGM) return;
	if (!game.settings.get('xeno-homebrew-mechanics', 'soul-toggle')) return;

	dev.debugGroupStart(`Long Rest — Soul Reset: ${actor.name}`);
	await soul.resetSoul(actor);
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
