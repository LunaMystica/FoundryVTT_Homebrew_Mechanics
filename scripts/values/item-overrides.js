import { OVERRIDE_KEYS, TOGGLE_KEYS, getBaseEnduranceReduction, getItemOverride, getSoulValues } from './values.js';
import { escapeHtml } from '../core/html.js';

const MODULE_ID = 'xeno-homebrew-mechanics';

/**
 * Builds one labelled number input for the overrides dialog.
 * @param {string} name
 * @param {number|null} value - Current override, or null for "use default".
 * @param {number} fallback - Shown as the placeholder; used when blank.
 * @param {object} hintData - Substitutions for the field's hint string.
 */
function numberField(name, value, fallback, hintData) {
	const label = game.i18n.localize(`XHM.Overrides.${name}.Name`);
	const hint = game.i18n.format(`XHM.Overrides.${name}.Hint`, hintData);
	return `<div class="form-group">
		<label for="xhm-override-${name}">${escapeHtml(label)}</label>
		<div class="form-fields">
			<input id="xhm-override-${name}" type="number" name="${name}" min="0" step="1"
				value="${value ?? ''}" placeholder="${fallback}">
		</div>
		<p class="hint">${escapeHtml(hint)}</p>
	</div>`;
}

/**
 * Builds one labelled checkbox for the overrides dialog.
 * @param {string} name
 * @param {boolean} checked
 * @param {boolean} [indent=false] - Render as a sub-option of the previous toggle.
 */
function toggleField(name, checked, indent = false) {
	const label = game.i18n.localize(`XHM.Overrides.${name}.Name`);
	const hint = game.i18n.localize(`XHM.Overrides.${name}.Hint`);
	return `<div class="form-group xhm-override-toggle${indent ? ' xhm-override-sub' : ''}">
		<label for="xhm-override-${name}">${escapeHtml(label)}</label>
		<div class="form-fields">
			<input id="xhm-override-${name}" type="checkbox" name="${name}" ${checked ? 'checked' : ''}>
		</div>
		<p class="hint">${escapeHtml(hint)}</p>
	</div>`;
}

/**
 * Opens a dialog to set (or clear) an item's Endurance/Soul overrides.
 * Blank fields remove the override so the item falls back to the world values.
 * @param {Item} item
 */
export async function openItemOverrides(item) {
	const keys = Object.values(OVERRIDE_KEYS);
	const baseReduction = getBaseEnduranceReduction(item);
	const { attackPerTarget, aoePerTarget } = getSoulValues();
	const content = `<p class="hint">${escapeHtml(game.i18n.localize('XHM.Overrides.Hint'))}</p>
		${numberField(OVERRIDE_KEYS.enduranceReduction, getItemOverride(item, OVERRIDE_KEYS.enduranceReduction), baseReduction, { value: baseReduction })}
		${numberField(OVERRIDE_KEYS.soulGainPerTarget, getItemOverride(item, OVERRIDE_KEYS.soulGainPerTarget), attackPerTarget, { attack: attackPerTarget, aoe: aoePerTarget })}
		${toggleField(TOGGLE_KEYS.ignoreWeakness, !!item.flags?.[MODULE_ID]?.[TOGGLE_KEYS.ignoreWeakness])}
		${toggleField(TOGGLE_KEYS.bypassResistance, !!item.flags?.[MODULE_ID]?.[TOGGLE_KEYS.bypassResistance], true)}`;

	const result = await foundry.applications.api.DialogV2.input({
		window: {
			title: game.i18n.format('XHM.Overrides.Title', { name: item.name }),
			icon: 'fa-solid fa-shield-halved',
		},
		content,
		ok: { label: 'XHM.Overrides.Save', icon: 'fa-solid fa-save' },
		// The bypass toggle only makes sense on top of "ignore weaknesses": disable it otherwise.
		render: (_event, dialog) => {
			const ignore = dialog.element.querySelector(`[name="${TOGGLE_KEYS.ignoreWeakness}"]`);
			const bypass = dialog.element.querySelector(`[name="${TOGGLE_KEYS.bypassResistance}"]`);
			if (!ignore || !bypass) return;
			const sync = () => {
				bypass.disabled = !ignore.checked;
				if (!ignore.checked) bypass.checked = false;
				bypass.closest('.form-group')?.classList.toggle('disabled', !ignore.checked);
			};
			ignore.addEventListener('change', sync);
			sync();
		},
	});
	if (!result) return;

	const update = {};
	for (const key of keys) {
		const value = result[key];
		const valid = value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
		if (valid) update[`flags.${MODULE_ID}.${key}`] = Number(value);
		else if (item.flags?.[MODULE_ID]?.[key] !== undefined) update[`flags.${MODULE_ID}.-=${key}`] = null;
	}

	// Toggles: store only when on (a disabled checkbox is omitted from the form → off).
	const ignore = !!result[TOGGLE_KEYS.ignoreWeakness];
	const toggles = {
		[TOGGLE_KEYS.ignoreWeakness]: ignore,
		[TOGGLE_KEYS.bypassResistance]: ignore && !!result[TOGGLE_KEYS.bypassResistance],
	};
	for (const [key, on] of Object.entries(toggles)) {
		if (on) update[`flags.${MODULE_ID}.${key}`] = true;
		else if (item.flags?.[MODULE_ID]?.[key] !== undefined) update[`flags.${MODULE_ID}.-=${key}`] = null;
	}
	if (Object.keys(update).length) await item.update(update);
}

/**
 * Adds a GM-only "Homebrew Overrides" entry to item sheet header menus
 * (ApplicationV2 sheets: dnd5e and Tidy5e on v13).
 */
export function registerItemOverrideControls() {
	Hooks.on('getHeaderControlsDocumentSheetV2', (app, controls) => {
		if (!game.user.isGM || app.document?.documentName !== 'Item') return;
		if (controls.some((c) => c.action === 'xhmItemOverrides')) return;
		controls.push({
			icon: 'fa-solid fa-shield-halved',
			label: 'XHM.Overrides.Control',
			action: 'xhmItemOverrides',
			onClick: () => openItemOverrides(app.document),
		});
	});
}
