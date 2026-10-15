import { OVERRIDE_KEYS, getBaseEnduranceReduction, getItemOverride, getSoulValues } from './values.js';
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
		${numberField(OVERRIDE_KEYS.soulGainPerTarget, getItemOverride(item, OVERRIDE_KEYS.soulGainPerTarget), attackPerTarget, { attack: attackPerTarget, aoe: aoePerTarget })}`;

	const result = await foundry.applications.api.DialogV2.input({
		window: {
			title: game.i18n.format('XHM.Overrides.Title', { name: item.name }),
			icon: 'fa-solid fa-shield-halved',
		},
		content,
		ok: { label: 'XHM.Overrides.Save', icon: 'fa-solid fa-save' },
	});
	if (!result) return;

	const update = {};
	for (const key of keys) {
		const value = result[key];
		const valid = value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
		if (valid) update[`flags.${MODULE_ID}.${key}`] = Number(value);
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
