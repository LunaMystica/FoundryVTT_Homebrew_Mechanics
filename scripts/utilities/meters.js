// prettier-ignore
const { utils: { genericUtils } } = chrisPremades;

import { dev } from './dev.js';

/**
 * The meters rendered on the Tidy5e character sheet.
 * `name` must match the actor item's name (see `actor.items.getName`),
 * mirroring how Endurance/Soul are resolved elsewhere in this module.
 * `modifier` is the CSS modifier suffix used for per-meter colouring.
 * `type` selects the renderer: 'bar' (default), 'pips', or 'stars'.
 * `group` (optional): meters sharing a group are rendered together in a cluster
 * (charge-style meters stacked above the group's bar).
 * `criticalPct` (optional): when the current value is at or below this fraction
 * of max, a bar pulses a warning glow (see `.hbm-critical` in CSS).
 */
const METERS = [
	{ name: 'Endurance', modifier: 'endurance', type: 'bar', criticalPct: 0.25 },
	{ name: 'Soul', modifier: 'soul', type: 'bar', group: 'soul' },
	{ name: 'Soulstrike', modifier: 'soulstrike', type: 'pips', group: 'soul' },
	{ name: 'Soulburst', modifier: 'soulburst', type: 'stars', group: 'soul' },
];

/**
 * Per-meter colours.
 * - `baseVar` is the canonical hue (a CSS var on `.tidy5e-sheet` defaulting to a
 *   Tidy theme palette token, hex fallback). A world setting `meter-color-<key>`
 *   overrides the base; blank = default.
 * - `cssVar` is the final colour the meters actually use. It defaults to the
 *   base, but is tinted per-actor with the sheet's Tidy accent colour by
 *   `_applyActorColors` (so each character's meters harmonise with their theme).
 * `module.js` registers the settings from this list and calls `applyColors()`.
 */
const COLORS = [
	{
		key: 'endurance',
		label: 'Endurance',
		baseVar: '--hbm-base-endurance',
		cssVar: '--hbm-color-endurance',
		fallback: '#9b2c2c',
	},
	{ key: 'soul', label: 'Soul', baseVar: '--hbm-base-soul', cssVar: '--hbm-color-soul', fallback: '#2c5282' },
	{
		key: 'soulstrike',
		label: 'Soulstrike',
		baseVar: '--hbm-base-soulstrike',
		cssVar: '--hbm-color-soulstrike',
		fallback: '#6b46c1',
	},
	{
		key: 'soulburst',
		label: 'Soulburst',
		baseVar: '--hbm-base-soulburst',
		cssVar: '--hbm-color-soulburst',
		fallback: '#b83280',
	},
];

/** How strongly the actor's accent colour tints the base hue (0–1). */
const ACCENT_TINT = 0.15;

/** OKLCH lightness delta applied for contrast: lighter on dark themes, darker on light themes. */
const THEME_SHIFT = 0.1;

/** OKLCH chroma multiplier, to keep hues vivid after tinting toward a pale accent. */
const CHROMA_BOOST = 1.3;

class Meters {
	// ── Registration ───────────────────────────────────────────────────────────

	/**
	 * Registers the meter content with Tidy5e. Called once from the
	 * `tidy5e-sheet.ready` hook. Injects a single container per layout and
	 * (re)builds the meters on every sheet render.
	 *
	 * Quadrone bars reuse Tidy's native `.meter.progress` markup (matching the
	 * HP / Hit Die bars); the classic layout — whose HP is a portrait overlay we
	 * can't replicate — uses a self-contained bar in a full-width strip below the
	 * header. Charge meters (pips/stars) are custom markup shared by both layouts.
	 *
	 * @param {object} api - The Tidy5e Sheets API passed to `tidy5e-sheet.ready`.
	 */
	register(api) {
		const { SHEET_PARTS } = api.constants;

		const make = (selector, position, layout) =>
			new api.models.HtmlContent({
				html: '<div class="hbm-meters" data-hbm-meters></div>',
				injectParams: { selector, position },
				onRender: ({ app, element }) => this._onRender(app, element, layout),
			});

		// Classic: a full-width strip below the entire header (spanning under both
		// the portrait and the stats). The portrait area is a tight, absolutely-
		// positioned block (HP/AC overlays) that clips against neighbouring UI, so
		// we sit below the header and blend with its background (see CSS).
		api.registerCharacterContent(make('.tidy5e-sheet-header', 'afterend', 'classic'), { layout: 'classic' });
		// Quadrone: under the name row. The portrait is a fixed-height image, so a
		// compact arrangement keeps the gap beside the portrait as small as possible.
		api.registerCharacterContent(
			make(api.getSheetPartSelector(SHEET_PARTS.NAME_HEADER_ROW), 'afterend', 'quadrone'),
			{
				layout: 'quadrone',
			},
		);

		dev.debugLog('info', 'Meters registered with Tidy5e (classic + quadrone)');
	}

	// ── Colours ────────────────────────────────────────────────────────────────

	/**
	 * Applies the per-meter base-colour overrides from world settings by writing a
	 * single `<style>` tag that sets the `--hbm-base-*` variables on
	 * `.tidy5e-sheet`. Blank settings are skipped (the CSS default — a Tidy theme
	 * palette token — wins). Called once on `ready` and on each setting change.
	 */
	applyColors() {
		const id = 'hbm-meter-colors';
		document.getElementById(id)?.remove();

		const decls = COLORS.map((c) => ({
			c,
			value: (game.settings.get('xeno-homebrew-mechanics', `meter-color-${c.key}`) ?? '').trim(),
		}))
			.filter(({ value }) => value)
			.map(({ c, value }) => `${c.baseVar}: ${value};`);

		if (!decls.length) return;

		const style = document.createElement('style');
		style.id = id;
		style.textContent = `.tidy5e-sheet { ${decls.join(' ')} }`;
		document.head.appendChild(style);
		dev.debugLog('info', `Applied ${decls.length} meter base-colour override(s)`);
	}

	/**
	 * Computes each meter's final colour and writes it as an inline `--hbm-color-*`
	 * variable on the meter container. Two adjustments stack on the base hue:
	 *   1. tint toward the actor's Tidy accent colour (from the sheet theme flags),
	 *      mixed in OKLCH to limit muddiness;
	 *   2. adjust OKLCH lightness for contrast — lighter on a dark theme, darker on
	 *      a light theme — and boost chroma, so the hue stays vivid rather than
	 *      washing out (mixing toward a pale accent / white drains saturation).
	 *
	 * @param {HTMLElement} container - The injected `[data-hbm-meters]` element.
	 * @param {HTMLElement} element - The whole sheet application window (theme source).
	 * @param {Actor} actor
	 */
	_applyActorColors(container, element, actor) {
		const accent = actor.getFlag('tidy5e-sheet', 'sheet-theme-settings')?.accentColor;
		const accentPct = Math.round(ACCENT_TINT * 100);
		const delta = this._isDarkTheme(element) ? THEME_SHIFT : -THEME_SHIFT;

		for (const c of COLORS) {
			const tinted = accent
				? `color-mix(in oklch, var(${c.baseVar}), ${accent} ${accentPct}%)`
				: `var(${c.baseVar})`;
			container.style.setProperty(
				c.cssVar,
				`oklch(from ${tinted} clamp(0.25, calc(l + ${delta}), 0.85) calc(c * ${CHROMA_BOOST}) h)`,
			);
		}
	}

	/**
	 * Whether the sheet is rendering with Tidy's dark theme. Reads the rendered
	 * `theme-dark`/`theme-light` class from the application root (not descendants —
	 * the vitals box is always `theme-dark`), falling back to the OS preference.
	 *
	 * @param {HTMLElement} element - The sheet application window.
	 * @returns {boolean}
	 */
	_isDarkTheme(element) {
		const root = element.closest('.theme-dark, .theme-light') ?? element;
		if (root.classList.contains('theme-dark')) return true;
		if (root.classList.contains('theme-light')) return false;
		return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
	}

	// ── Render ─────────────────────────────────────────────────────────────────

	/**
	 * Rebuilds the meter markup for one sheet render and wires up interaction.
	 * Safe to run on every render: the container is re-injected each cycle, so
	 * we always rebuild from the current item state and re-attach listeners.
	 *
	 * @param {object} app - The Tidy5e sheet application (`app.document` is the actor).
	 * @param {HTMLElement} element - The whole sheet application window.
	 * @param {'classic'|'quadrone'} layout
	 */
	_onRender(app, element, layout) {
		const container = element.querySelector('[data-hbm-meters]');
		if (!container) return;

		if (!game.settings.get('xeno-homebrew-mechanics', 'meters-toggle')) {
			container.innerHTML = '';
			return;
		}

		const actor = app.document;
		const editable = actor.isOwner;

		this._applyActorColors(container, element, actor);

		const present = METERS.map((m) => ({ ...m, item: actor.items.getName(m.name) })).filter(
			(m) => m.item?.system?.uses?.max > 0,
		);

		const units = this._buildUnits(present);
		container.innerHTML = units.map((u) => this._renderUnit(u, layout, editable)).join('');

		if (editable) this._wireInteraction(actor, container, layout);
	}

	/**
	 * Partitions the present meters into render units, preserving order:
	 * ungrouped meters become standalone units; meters sharing a `group` are
	 * collected into one cluster unit.
	 *
	 * @param {object[]} meters
	 * @returns {Array<{kind:'single',meter:object}|{kind:'group',group:string,meters:object[]}>}
	 */
	_buildUnits(meters) {
		const units = [];
		const groups = new Map();
		for (const m of meters) {
			if (!m.group) {
				units.push({ kind: 'single', meter: m });
				continue;
			}
			if (!groups.has(m.group)) {
				const unit = { kind: 'group', group: m.group, meters: [] };
				groups.set(m.group, unit);
				units.push(unit);
			}
			groups.get(m.group).meters.push(m);
		}
		return units;
	}

	/**
	 * Renders a single meter or a cluster. In a cluster the charge meters
	 * (pips/stars) are stacked in a row above the group's bar.
	 */
	_renderUnit(unit, layout, editable) {
		if (unit.kind === 'single') return this._renderMeter(unit.meter, layout, editable);

		const charges = unit.meters.filter((m) => m.type === 'pips' || m.type === 'stars');
		const bars = unit.meters.filter((m) => !m.type || m.type === 'bar');
		const chargesHtml = charges.length
			? `<div class="hbm-cluster__charges">${charges.map((m) => this._chargesMarkup(m, editable)).join('')}</div>`
			: '';
		const barsHtml = bars.map((m) => this._renderBar(m, layout, editable)).join('');

		return `<div class="hbm-cluster hbm-cluster--${unit.group}">${chargesHtml}${barsHtml}</div>`;
	}

	_renderMeter(meter, layout, editable) {
		if (meter.type === 'pips' || meter.type === 'stars') return this._chargesMarkup(meter, editable);
		return this._renderBar(meter, layout, editable);
	}

	_renderBar(meter, layout, editable) {
		return layout === 'quadrone' ? this._quadroneMarkup(meter, editable) : this._classicMarkup(meter, editable);
	}

	// ── Markup: bars ─────────────────────────────────────────────────────────────

	/**
	 * Quadrone bar: reuses Tidy's native `.meter.progress` classes so the bar
	 * matches the HP / Hit Die bars. Colour is driven by per-modifier CSS that
	 * sets `--bar-background`; fill length by the inline `--bar-percentage`.
	 */
	_quadroneMarkup({ name, modifier, item, criticalPct }, editable) {
		const max = item.system.uses.max;
		const value = item.system.uses.value;
		const pct = max ? Math.round((value / max) * 100) : 0;
		const critical = criticalPct != null && value <= max * criticalPct;
		const tag = editable ? 'button' : 'div';

		return `
			<div class="meter progress hbm-bar hbm-bar--${modifier}${pct === 0 ? ' empty' : ''}${critical ? ' hbm-critical' : ''}" style="--bar-percentage: ${pct}%" data-item-id="${item.id}" data-max="${max}" role="meter" aria-valuenow="${value}" aria-valuemax="${max}" aria-label="${name}">
				<${tag} class="label pointer hbm-bar__label"${editable ? ' type="button"' : ''}>
					<span class="hbm-bar__name">${name}</span>
					<span class="hbm-bar__nums"><span class="value">${value}</span><span class="separator">/</span><span class="max">${max}</span></span>
				</${tag}>
				${editable ? `<input class="hbm-bar__input" type="number" min="0" max="${max}" value="${value}" aria-label="${name}" hidden />` : ''}
			</div>`;
	}

	/**
	 * Classic bar: a self-contained horizontal bar (the classic HP overlay is not
	 * reusable from injected HTML).
	 */
	_classicMarkup({ name, modifier, item, criticalPct }, editable) {
		const max = item.system.uses.max;
		const value = item.system.uses.value;
		const pct = max ? Math.round((value / max) * 100) : 0;
		const critical = criticalPct != null && value <= max * criticalPct;
		const input = editable
			? `<input class="hbm-meter__input" type="number" min="0" max="${max}" value="${value}" aria-label="${name}" />`
			: `<span class="hbm-meter__value">${value}</span>`;

		return `
			<div class="hbm-meter hbm-meter--${modifier}${critical ? ' hbm-critical' : ''}" data-item-id="${item.id}" data-max="${max}">
				<div class="hbm-meter__head">
					<span class="hbm-meter__label">${name}</span>
					<span class="hbm-meter__count">${input}<span class="hbm-meter__sep">/</span><span class="hbm-meter__max">${max}</span></span>
				</div>
				<div class="hbm-meter__track" role="meter" aria-valuenow="${value}" aria-valuemax="${max}">
					<div class="hbm-meter__fill" style="width:${pct}%"></div>
				</div>
			</div>`;
	}

	// ── Markup: charges (pips / stars) ─────────────────────────────────────────────

	/**
	 * Charge meter: one icon per point of max, the first `value` filled. Shared by
	 * both layouts. `type` picks the icon (pips → diamonds, stars → stars).
	 *
	 * @param {{ name: string, modifier: string, item: Item, type: string }} meter
	 * @param {boolean} editable
	 * @returns {string}
	 */
	_chargesMarkup({ name, modifier, item, type }, editable) {
		const max = item.system.uses.max;
		const value = item.system.uses.value;
		// Solid icons for both states (FA Free has no regular diamond); empties are
		// dimmed via `.hbm-empty`.
		const icon = type === 'stars' ? 'fa-star' : 'fa-diamond';

		let icons = '';
		for (let i = 1; i <= max; i++)
			icons += `<i class="fas ${icon}${i <= value ? '' : ' hbm-empty'}" data-i="${i}"></i>`;

		return `
			<div class="hbm-charges hbm-charges--${modifier}${editable ? ' hbm-charges--editable' : ''}" data-item-id="${item.id}" data-max="${max}" role="meter" aria-valuenow="${value}" aria-valuemax="${max}" aria-label="${name}">
				<span class="hbm-charges__label">${name}</span>
				<span class="hbm-charges__icons">${icons}</span>
			</div>`;
	}

	// ── Interaction ──────────────────────────────────────────────────────────────

	/**
	 * Attaches edit handlers. All edits resolve to a target current `value`,
	 * written back as `spent = max - value` (the writable field). The resulting
	 * item update triggers a sheet re-render, which redraws the meter — the item
	 * is the source of truth, so no local state is kept.
	 *
	 * @param {Actor} actor
	 * @param {HTMLElement} container
	 * @param {'classic'|'quadrone'} layout
	 */
	_wireInteraction(actor, container, layout) {
		for (const el of container.querySelectorAll('.hbm-bar, .hbm-meter, .hbm-charges')) {
			const item = actor.items.get(el.dataset.itemId);
			if (!item) continue;
			const max = Number(el.dataset.max);

			if (el.classList.contains('hbm-charges')) this._wireCharges(el, item, max);
			else if (el.classList.contains('hbm-bar')) this._wireQuadrone(el, item, max);
			else this._wireClassic(el, item, max);
		}
	}

	/**
	 * Charges: click an icon to set the value to its position; click the current
	 * highest filled icon again to drop one (the usual dnd5e pip behaviour).
	 */
	_wireCharges(el, item, max) {
		el.querySelector('.hbm-charges__icons')?.addEventListener('click', (ev) => {
			const i = Number(ev.target?.dataset?.i);
			if (!i) return;
			const cur = item.system.uses.value;
			this._setValue(item, max, i === cur ? i - 1 : i);
		});
	}

	/**
	 * Quadrone bar: click the bar to reveal an inline input (mirrors the native HP
	 * field), commit on blur/Enter, cancel on Escape.
	 */
	_wireQuadrone(el, item, max) {
		const label = el.querySelector('.hbm-bar__label');
		const input = el.querySelector('.hbm-bar__input');
		if (!label || !input) return;

		label.addEventListener('click', () => {
			label.hidden = true;
			input.hidden = false;
			input.focus();
			input.select();
		});
		input.addEventListener('blur', () => {
			label.hidden = false;
			input.hidden = true;
			this._setValue(item, max, parseInt(input.value, 10) || 0);
		});
		input.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter') input.blur();
			else if (ev.key === 'Escape') {
				input.value = item.system.uses.value;
				input.blur();
			}
		});
	}

	/**
	 * Classic bar: number input sets the value; left-click the track spends 1,
	 * right-click restores 1.
	 */
	_wireClassic(el, item, max) {
		const setValue = (value) => this._setValue(item, max, value);

		el.querySelector('.hbm-meter__input')?.addEventListener('change', (ev) =>
			setValue(parseInt(ev.currentTarget.value, 10) || 0),
		);

		const track = el.querySelector('.hbm-meter__track');
		track?.addEventListener('click', () => setValue(item.system.uses.value - 1));
		track?.addEventListener('contextmenu', (ev) => {
			ev.preventDefault();
			setValue(item.system.uses.value + 1);
		});
	}

	/**
	 * Writes a clamped current value to an item by setting `uses.spent`.
	 *
	 * @param {Item} item
	 * @param {number} max
	 * @param {number} value - Desired current value; clamped to [0, max].
	 */
	async _setValue(item, max, value) {
		const clamped = Math.clamp(value, 0, max);
		const spent = max - clamped;
		if (spent === item.system.uses.spent) return;

		dev.debugLog('info', `${item.actor?.name}: ${item.name} → ${clamped}/${max} (spent ${spent})`);
		await genericUtils.update(item, { 'system.uses.spent': spent });
	}
}

export const meters = new Meters();

/** Themeable meter colours; consumed by `module.js` for settings + the picker UI. */
export const meterColors = COLORS;
