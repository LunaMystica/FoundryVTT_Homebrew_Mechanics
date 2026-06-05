import { endurance, soul, meters, meterColors, dev, chatLog } from './index.js';
import { EnduranceBreakConfig } from './endurance/break-config.js';
import { damageTypeFeatures } from './endurance/damage-type-features.js';

// prettier-ignore
const { utils: { genericUtils } } = chrisPremades;

// ── Settings Registration ──────────────────────────────────────────────────────
Hooks.once('init', () => {
	game.settings.registerMenu('xeno-homebrew-mechanics', 'endurance-damage-items-menu', {
		name: 'XHM.Menu.EnduranceBreakItems.Name',
		label: 'XHM.Menu.EnduranceBreakItems.Label',
		hint: 'XHM.Menu.EnduranceBreakItems.Hint',
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
			name: 'XHM.Settings.EnduranceToggle.Name',
			hint: 'XHM.Settings.EnduranceToggle.Hint',
			type: Boolean,
			default: true,
		},
		{
			key: 'soul-toggle',
			name: 'XHM.Settings.SoulToggle.Name',
			hint: 'XHM.Settings.SoulToggle.Hint',
			type: Boolean,
			default: true,
		},
		{
			key: 'debug-toggle',
			name: 'XHM.Settings.Debug.Name',
			hint: 'XHM.Settings.Debug.Hint',
			type: Boolean,
			default: false,
		},
		{
			key: 'chat-message-toggle',
			name: 'XHM.Settings.ChatMessages.Name',
			hint: 'XHM.Settings.ChatMessages.Hint',
			type: Boolean,
			default: false,
		},
		{
			key: 'meters-toggle',
			name: 'XHM.Settings.Meters.Name',
			hint: 'XHM.Settings.Meters.Hint',
			type: Boolean,
			default: true,
		},
		{
			key: 'hide-messages-toggle',
			name: 'XHM.Settings.HideMessages.Name',
			hint: 'XHM.Settings.HideMessages.Hint',
			type: Boolean,
			default: false,
		},
		{
			key: 'soul-item-blacklist',
			name: 'XHM.Settings.SoulItemBlacklist.Name',
			hint: 'XHM.Settings.SoulItemBlacklist.Hint',
			type: String,
			default: 'Blessed Healer,Flames of Madness',
		},
		{
			key: 'soul-section-blacklist',
			name: 'XHM.Settings.SoulSectionBlacklist.Name',
			hint: 'XHM.Settings.SoulSectionBlacklist.Hint',
			type: String,
			default: 'Soulburst,Weakness Break',
		},
		{
			key: 'force-reload',
			name: 'XHM.Settings.ForceReload.Name',
			hint: 'XHM.Settings.ForceReload.Hint',
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

// ── Per-Meter Colour Settings ──────────────────────────────────────────────────
// Registered on i18nInit (not init) because their names are formatted eagerly with
// `game.i18n.format`, and translations are only loaded after the `init` hook fires.

Hooks.once('i18nInit', () => {
	// Per-meter colour overrides (blank = Tidy theme default). Re-apply live on change.
	for (const { key, label } of meterColors) {
		game.settings.register('xeno-homebrew-mechanics', `meter-color-${key}`, {
			name: game.i18n.format('XHM.Settings.MeterColor.Name', { label }),
			hint: game.i18n.format('XHM.Settings.MeterColor.Hint', { label }),
			scope: 'world',
			config: true,
			type: String,
			default: '',
			onChange: () => meters.applyColors(),
		});
	}
});

// ── Global API ─────────────────────────────────────────────────────────────────

Hooks.once('ready', () => {
	globalThis['xenoHomebrewMechanics'] = { endurance, soul, meters, dev, chatLog };
	meters.applyColors();
	dev.debugLog('info', 'Global API registered on xenoHomebrewMechanics');
});

// ── Tidy5e Sheet Meters ────────────────────────────────────────────────────────

Hooks.once('tidy5e-sheet.ready', (api) => {
	meters.register(api);
});

// Add a native colour picker beside each meter-colour setting (blank = default).
Hooks.on('renderSettingsConfig', (app, [form]) => {
	for (const { key, fallback } of meterColors) {
		const input = form.querySelector(`input[name="xeno-homebrew-mechanics.meter-color-${key}"]`);
		if (!input || input.dataset.hbmPicker) continue;
		input.dataset.hbmPicker = 'true';
		input.placeholder = 'Theme default';

		const picker = document.createElement('input');
		picker.type = 'color';
		picker.value = input.value || fallback;
		picker.addEventListener('input', () => (input.value = picker.value));
		input.addEventListener('input', () => (picker.value = input.value || fallback));
		input.insertAdjacentElement('afterend', picker);
	}
});

// ── Chat Message Visibility ────────────────────────────────────────────────────

Hooks.on('renderChatMessage', (message, [html]) => {
	if (game.user.isGM) return;
	if (message.speaker?.alias !== 'HBM') return;
	if (!game.settings.get('xeno-homebrew-mechanics', 'hide-messages-toggle')) return;

	const card = html.querySelector('.hbm-card');
	if (!card) return;

	for (const row of card.querySelectorAll('.hbm-row[data-actor-uuid]')) {
		const actor = fromUuidSync(row.dataset.actorUuid);
		if (!actor?.testUserPermission(game.user, 'OWNER')) row.style.display = 'none';
	}

	const entries = [];
	for (const el of card.children) {
		if (el.classList.contains('hbm-section-header')) {
			entries.push({ kind: 'section', header: el, rows: [] });
		} else if (el.classList.contains('hbm-row')) {
			const last = entries.at(-1);
			if (last?.kind === 'section') last.rows.push(el);
		} else if (el.classList.contains('hbm-divider')) {
			entries.push({ kind: 'hr', hr: el });
		}
	}

	for (const e of entries) {
		if (e.kind !== 'section') continue;
		e.visible = e.rows.some((r) => r.style.display !== 'none');
		if (!e.visible) e.header.style.display = 'none';
	}

	for (let i = 0; i < entries.length; i++) {
		if (entries[i].kind !== 'hr') continue;
		const before = entries.slice(0, i).some((x) => x.kind === 'section' && x.visible);
		const after = entries.slice(i + 1).some((x) => x.kind === 'section' && x.visible);
		if (!(before && after)) entries[i].hr.style.display = 'none';
	}

	if (!entries.some((e) => e.kind === 'section' && e.visible)) html.style.display = 'none';
});

// ── MidiQOL Workflow ───────────────────────────────────────────────────────────

Hooks.on('midi-qol.postActiveEffects', async (workflow) => {
	const enduranceEnabled = game.settings.get('xeno-homebrew-mechanics', 'endurance-toggle');
	const soulEnabled = game.settings.get('xeno-homebrew-mechanics', 'soul-toggle');

	dev.debugGroupStart(
		`${workflow.actor.name}: ${workflow.item.name} — endurance: ${enduranceEnabled}, soul: ${soulEnabled}`,
	);

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
				return genericUtils.update(tokenDoc, {
					flags: {
						'xeno-homebrew-mechanics': {
							lastHit: {
								itemUuid: workflow.item.uuid,
								activityUuid: workflow.activity.uuid,
								round: combatRound,
								turn: combatTurn,
							},
						},
					},
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
				dev.debugLog(
					'warning',
					`Could not reset endurance for ${combatant.actor?.name ?? 'unknown'}: ${err.message}`,
				);
			}
		}),
	);

	dev.debugLog('success', 'Endurance reset complete');
	dev.debugGroupEnd();
});
