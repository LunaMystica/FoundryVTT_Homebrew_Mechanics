import { escapeHtml } from '../core/html.js';

const MODULE_ID = 'xeno-homebrew-mechanics';

/** Fraction of max at or below which the bar shows the "critical" state (matches the sheet meter). */
const CRITICAL_PCT = 0.25;

/** Weakness icons shown inline; the rest collapse into a "+N" chip (all are listed in the tooltip). */
const MAX_WEAKNESS_ICONS = 2;

/**
 * Shows each combatant's Endurance (and weaknesses) on the combat tracker.
 *
 * Visibility is ownership-aware:
 * - GM and users with at least Observer permission on the actor see everything:
 *   the bar, the exact value and the weaknesses.
 * - Everyone else gets the `tracker-visibility` world setting: `full`, `bar`
 *   (bar + broken state, no numbers or weaknesses) or `none`.
 * Hidden combatants are already removed from players' trackers by Foundry.
 */
class Tracker {
	#renderQueued = false;

	// ── Registration ───────────────────────────────────────────────────────────

	register() {
		Hooks.on('renderCombatTracker', (app, html) =>
			this.decorate(app, html instanceof HTMLElement ? html : html[0]),
		);

		// Re-render when an Endurance item changes (spent/max) or weaknesses change.
		const onItem = (item) => {
			if (item.name === 'Endurance' && this.#inCombat(item.parent)) this.refresh();
		};
		Hooks.on('updateItem', onItem);
		Hooks.on('createItem', onItem);
		Hooks.on('deleteItem', onItem);
		Hooks.on('updateActor', (actor, change) => {
			if (foundry.utils.hasProperty(change, 'system.traits.dv') && this.#inCombat(actor)) this.refresh();
		});
	}

	/** Debounced re-render of every open combat tracker (sidebar + popouts). */
	refresh() {
		if (this.#renderQueued) return;
		this.#renderQueued = true;
		requestAnimationFrame(() => {
			this.#renderQueued = false;
			const CombatTracker = foundry.applications?.sidebar?.tabs?.CombatTracker;
			const instances = CombatTracker ? [...(foundry.applications.instances?.values() ?? [])] : [];
			const trackers = instances.filter((app) => app instanceof CombatTracker && app.rendered);
			if (trackers.length) trackers.forEach((app) => app.render());
			else ui.combat?.render();
		});
	}

	// ── Rendering ──────────────────────────────────────────────────────────────

	/**
	 * @param {Application} app - The CombatTracker.
	 * @param {HTMLElement} html
	 */
	decorate(app, html) {
		if (!html || !game.settings.get(MODULE_ID, 'tracker-toggle')) return;
		const combat = app.viewed ?? game.combat;
		if (!combat) return;

		for (const li of html.querySelectorAll('.combatant[data-combatant-id]')) {
			li.querySelector('.hbm-tracker')?.remove();
			const actor = combat.combatants.get(li.dataset.combatantId)?.actor;
			const element = actor ? this.#buildElement(actor) : null;
			if (!element) continue;

			// Directly under the name (v13: strong.name, v12: h4); else at the end of the name block.
			const name = li.querySelector('.token-name .name, .token-name h4');
			if (name) name.after(element);
			else li.querySelector('.token-name')?.append(element);
		}
	}

	/**
	 * @param {Actor} actor
	 * @returns {HTMLElement|null}
	 */
	#buildElement(actor) {
		const item = actor.items.getName('Endurance');
		const max = item?.system.uses?.max ?? 0;
		if (!item || !max) return null;

		const level = Tracker.visibilityFor(actor);
		if (level === 'none') return null;

		const value = Math.clamp(item.system.uses.value ?? max - (item.system.uses.spent ?? 0), 0, max);
		const broken = value <= 0;
		const pct = Math.round((value / max) * 100);
		const state = broken ? 'broken' : value / max <= CRITICAL_PCT ? 'critical' : 'ok';
		const full = level === 'full';

		const el = document.createElement('div');
		el.className = `hbm-tracker hbm-tracker--${state}`;
		el.style.setProperty('--hbm-tracker-pct', `${pct}%`);

		const color = (game.settings.get(MODULE_ID, 'meter-color-endurance') ?? '').trim();
		if (color) el.style.setProperty('--hbm-tracker-color', color);

		const weaknesses = full ? Tracker.#weaknesses(actor) : [];
		const label = game.i18n.localize('XHM.Tracker.Endurance');
		const countText = broken ? game.i18n.localize('XHM.Chat.Broken') : full ? `${value}/${max}` : '';

		el.innerHTML = `
			<i class="hbm-tracker__icon fa-solid ${broken ? 'fa-shield-slash' : 'fa-shield-halved'}" inert></i>
			<span class="hbm-tracker__track"><span class="hbm-tracker__fill"></span></span>
			${countText ? `<span class="hbm-tracker__count">${escapeHtml(countText)}</span>` : ''}
			${weaknesses.length ? `<span class="hbm-tracker__weak">${Tracker.#weaknessIcons(weaknesses)}</span>` : ''}`;

		const tooltip = [`<strong>${escapeHtml(label)}</strong>${full ? ` ${value}/${max}` : ''}`];
		if (broken) tooltip.push(escapeHtml(game.i18n.localize('XHM.Tracker.BrokenHint')));
		if (weaknesses.length) {
			tooltip.push(
				`${escapeHtml(game.i18n.localize('XHM.Tracker.Weaknesses'))}: ${weaknesses.map((w) => escapeHtml(w.label)).join(', ')}`,
			);
		}
		el.dataset.tooltipHtml = tooltip.join('<br>');
		el.setAttribute('aria-label', `${label} ${full ? `${value}/${max}` : `${pct}%`}`);
		return el;
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	/**
	 * How much of this actor's Endurance the current user may see.
	 * @param {Actor} actor
	 * @returns {'full'|'bar'|'none'}
	 */
	static visibilityFor(actor) {
		if (game.user.isGM || actor.testUserPermission(game.user, 'OBSERVER')) return 'full';
		return game.settings.get(MODULE_ID, 'tracker-visibility') ?? 'bar';
	}

	/**
	 * Inline icons for the first few weaknesses, then a "+N" chip for the rest.
	 * @param {{ label: string, icon: string }[]} weaknesses
	 * @returns {string}
	 */
	static #weaknessIcons(weaknesses) {
		const shown = Math.min(weaknesses.length, MAX_WEAKNESS_ICONS);
		const icons = weaknesses.slice(0, shown).map((w) => w.icon);
		const hidden = weaknesses.length - shown;
		if (hidden > 0) icons.push(`<span class="hbm-tracker__more">+${hidden}</span>`);
		return icons.join('');
	}

	/**
	 * @param {Actor} actor
	 * @returns {{ label: string, icon: string }[]}
	 */
	static #weaknesses(actor) {
		const useDnd5eIcon = !!customElements.get('dnd5e-icon');
		return [...(actor.system.traits?.dv?.value ?? [])].map((key) => {
			const cfg = CONFIG.DND5E?.damageTypes?.[key];
			const label = game.i18n.localize(cfg?.label ?? key);
			const color = cfg?.color?.css ?? '';
			const style = color ? ` style="color: ${color}"` : '';
			const src = cfg?.icon;
			let icon;
			if (!src) icon = `<span class="hbm-tracker__weak-text"${style}>${escapeHtml(label.slice(0, 2))}</span>`;
			else if (useDnd5eIcon) icon = `<dnd5e-icon src="${escapeHtml(src)}"${style}></dnd5e-icon>`;
			else icon = `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}">`;
			return { label, icon };
		});
	}

	/**
	 * @param {Actor|null} actor
	 * @returns {boolean}
	 */
	#inCombat(actor) {
		if (!actor) return false;
		return game.combats.some((combat) => combat.combatants.some((c) => c.actor?.uuid === actor.uuid));
	}
}

export const tracker = new Tracker();
