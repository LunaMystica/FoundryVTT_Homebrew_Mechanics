/**
 * Tunable numbers for Endurance and Soul, stored in two world settings and
 * edited through the **Endurance & Soul Values** menu (`values-config.js`).
 * Individual items can override the per-hit amounts via flags (see
 * `item-overrides.js`).
 */

const MODULE_ID = 'xeno-homebrew-mechanics';

/** Endurance lost per hit, by item kind. `critBonus` is added on a critical (unless the base is 0). */
export const ENDURANCE_DEFAULTS = Object.freeze({
	weapon: 1,
	cantrip: 2,
	spell: 3,
	soulstrike: 3,
	soulburst: 6,
	weaknessBreak: 0,
	feat: 3,
	other: 1,
	critBonus: 1,
});

/** Soul gained: per hit target for attacks / AoE, and per point of HP damage taken. */
export const SOUL_DEFAULTS = Object.freeze({
	attackPerTarget: 4,
	aoePerTarget: 3,
	damageTakenRatio: 1.2,
});

/** Item flag keys for per-item overrides (`flags.xeno-homebrew-mechanics.<key>`). */
export const OVERRIDE_KEYS = Object.freeze({
	enduranceReduction: 'enduranceReduction',
	soulGainPerTarget: 'soulGainPerTarget',
});

/** Item flag keys for per-item Endurance toggles. `bypassResistance` only applies with `ignoreWeakness`. */
export const TOGGLE_KEYS = Object.freeze({
	ignoreWeakness: 'ignoreWeakness',
	bypassResistance: 'bypassResistance',
});

/**
 * Merges a stored settings object over its defaults, dropping anything that
 * isn't a finite, non-negative number so a bad save can't break the maths.
 * @param {object} defaults
 * @param {object} stored
 * @returns {object}
 */
export function sanitizeValues(defaults, stored) {
	const result = { ...defaults };
	for (const key of Object.keys(defaults)) {
		const value = Number(stored?.[key]);
		if (stored?.[key] !== null && stored?.[key] !== '' && Number.isFinite(value) && value >= 0) result[key] = value;
	}
	return result;
}

/** @returns {typeof ENDURANCE_DEFAULTS} */
export function getEnduranceValues() {
	return sanitizeValues(ENDURANCE_DEFAULTS, game.settings.get(MODULE_ID, 'endurance-values'));
}

/** @returns {typeof SOUL_DEFAULTS} */
export function getSoulValues() {
	return sanitizeValues(SOUL_DEFAULTS, game.settings.get(MODULE_ID, 'soul-values'));
}

/**
 * The world-configured Endurance reduction for an item, ignoring overrides and crits.
 * Feats are classified by their Tidy5e section (Soulstrike / Soulburst / Weakness Break).
 * @param {Item} item
 * @returns {number}
 */
export function getBaseEnduranceReduction(item) {
	const values = getEnduranceValues();
	switch (item?.type) {
		case 'weapon':
			return values.weapon;
		case 'spell':
			return item.system.level === 0 ? values.cantrip : values.spell;
		case 'feat': {
			const section = item.flags?.['tidy5e-sheet']?.section ?? null;
			if (section === 'Soulstrike') return values.soulstrike;
			if (section === 'Soulburst') return values.soulburst;
			if (section === 'Weakness Break') return values.weaknessBreak;
			return values.feat;
		}
		default:
			return values.other;
	}
}

/**
 * Endurance lost when `item` hits a weakness: the item override if set, else the
 * world value, plus the crit bonus on a critical (a base of 0 always stays 0).
 * @param {Item} item
 * @param {boolean} [isCritical=false]
 * @returns {number}
 */
export function getEnduranceReduction(item, isCritical = false) {
	const base = getItemOverride(item, OVERRIDE_KEYS.enduranceReduction) ?? getBaseEnduranceReduction(item);
	return base === 0 ? 0 : base + (isCritical ? getEnduranceValues().critBonus : 0);
}

/**
 * Soul the attacker gains per hit target: the item override if set, else the
 * world attack / AoE amount.
 * @param {Item} item
 * @param {boolean} isAoe
 * @returns {number}
 */
export function getSoulGainPerTarget(item, isAoe) {
	const override = getItemOverride(item, OVERRIDE_KEYS.soulGainPerTarget);
	if (override !== null) return override;
	const values = getSoulValues();
	return isAoe ? values.aoePerTarget : values.attackPerTarget;
}

/**
 * How an item's hits decide whether Endurance is reduced:
 * - `weakness` (default): only damage matching a weakness.
 * - `ignoreWeakness`: any damage, unless the target resists or is immune to it.
 * - `bypass`: any damage, regardless of resistance or immunity.
 * @param {Item} item
 * @returns {'weakness'|'ignoreWeakness'|'bypass'}
 */
export function getEnduranceMode(item) {
	const flags = item?.flags?.[MODULE_ID] ?? {};
	if (!flags[TOGGLE_KEYS.ignoreWeakness]) return 'weakness';
	return flags[TOGGLE_KEYS.bypassResistance] ? 'bypass' : 'ignoreWeakness';
}

/**
 * Reads a numeric per-item override flag.
 * @param {Item} item
 * @param {string} key - One of OVERRIDE_KEYS.
 * @returns {number|null} The override, or null when unset/invalid.
 */
export function getItemOverride(item, key) {
	const value = item?.flags?.[MODULE_ID]?.[key];
	if (value === null || value === undefined || value === '') return null;
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : null;
}
