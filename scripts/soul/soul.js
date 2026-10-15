// prettier-ignore
const { utils: { genericUtils } } = chrisPremades;

import { dev } from '../core/dev.js';
import { mapSerialPerKey } from '../core/async-utils.js';
import { escapeHtml } from '../core/html.js';
import { getSoulGainPerTarget, getSoulValues } from '../values/values.js';

class Soul {
	// ── Helpers ────────────────────────────────────────────────────────────────

	/**
	 * Returns the display string for a Soul item's current uses.
	 * @param {Item} item
	 * @returns {string} e.g. "3/10"
	 */
	static usesDisplay(item) {
		return `${item.system.uses.value}/${item.system.uses.max}`;
	}

	/**
	 * Computes the new `spent` value after granting `increment` charges,
	 * clamped so spent never goes below 0.
	 * @param {Item} item
	 * @param {number} increment
	 * @returns {{ initialSpent: number, newSpent: number, actualGain: number }}
	 */
	static computeSpentAfterGain(item, increment) {
		const initialSpent = item.system.uses.spent;
		const newSpent = Math.max(initialSpent - increment, 0);
		const actualGain = initialSpent - newSpent;
		return { initialSpent, newSpent, actualGain };
	}

	/**
	 * Parses a comma-separated blacklist setting string into a trimmed Set.
	 * @param {string} settingKey
	 * @returns {Set<string>}
	 */
	static getBlacklistSetting(settingKey) {
		const raw = game.settings.get('xeno-homebrew-mechanics', settingKey) ?? '';
		return new Set(
			raw
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean),
		);
	}

	// ── Entry Point ────────────────────────────────────────────────────────────

	/**
	 * Main entry point. Validates the workflow, resolves blacklists, then
	 * independently processes attacker gain and per-target damage-taken gain.
	 * Returns an HTML section string, or null if nothing happened.
	 *
	 * @param {Workflow} workflow
	 * @param {import('../core/undo.js').UndoRecorder|null} [undo] - Collects changes for the Undo button.
	 * @returns {Promise<string|null>}
	 */
	async calculateSoul(workflow, undo = null) {
		dev.debugGroupStart('Soul');
		dev.debugLog('info', `Triggered by ${workflow.actor.name} using "${workflow.item.name}"`);

		if (workflow.hitTargets.size === 0) {
			dev.debugLog('warning', 'No targets hit — aborting');
			dev.debugGroupEnd();
			return null;
		}

		const itemBlacklist = Soul.getBlacklistSetting('soul-item-blacklist');
		const sectionBlacklist = Soul.getBlacklistSetting('soul-section-blacklist');

		const itemName = workflow.item.name.trimEnd();
		const itemSection = workflow.item.flags?.['tidy5e-sheet']?.section?.trimEnd() ?? null;

		const itemBlacklisted = itemBlacklist.has(itemName);
		const sectionBlacklisted = sectionBlacklist.has(itemSection);

		dev.debugLog(
			'info',
			`"${itemName}" (${itemSection ?? 'no section'}) — ${workflow.hitTargets.size} hit | blacklist: item=${itemBlacklisted} section=${sectionBlacklisted}`,
		);

		const attackerLine = await this._processAttackerGain(workflow, itemBlacklisted, sectionBlacklisted, undo);
		const targetLines = await this._processTargetGain(workflow, sectionBlacklisted, undo);

		dev.debugGroupEnd();

		const allLines = [...(attackerLine ? [attackerLine] : []), ...targetLines];
		if (allLines.length === 0) return null;
		return `<div class="hbm-section-header hbm-section-header--soul">${game.i18n.localize('XHM.Chat.Soul')}</div>${allLines.join('')}`;
	}

	// ── Attacker Gain ──────────────────────────────────────────────────────────

	/**
	 * Grants Soul charges to the attacker per hit target (attack / AoE amounts
	 * from the values menu, or the item's override).
	 * Skipped if the attacker has no Soul item, or if blacklisted.
	 * Returns a formatted message line, or null if skipped.
	 *
	 * @param {Workflow} workflow
	 * @param {boolean} itemBlacklisted
	 * @param {boolean} sectionBlacklisted
	 * @param {import('../core/undo.js').UndoRecorder|null} [undo]
	 * @returns {Promise<string|null>}
	 */
	async _processAttackerGain(workflow, itemBlacklisted, sectionBlacklisted, undo = null) {
		dev.debugGroupStart('Attacker Gain');

		const actor = workflow.actor;
		const sourceItem = actor.items.getName('Soul');

		if (!sourceItem) {
			dev.debugLog('warning', `${actor.name} has no Soul item — skipping`);
			dev.debugGroupEnd();
			return null;
		}

		if (itemBlacklisted || sectionBlacklisted) {
			dev.debugLog('warning', 'Blacklisted — skipping attacker gain');
			dev.debugGroupEnd();
			return null;
		}

		const isAoe = !!workflow.templateUuid;
		const perTarget = getSoulGainPerTarget(workflow.item, isAoe);
		const targets = isAoe ? workflow.hitTargets.size : workflow.damageList?.filter((t) => t.isHit).length || 1;
		const increment = targets * perTarget;
		dev.debugLog('math', `${isAoe ? 'AoE' : 'Attack'}: ${targets} hit × ${perTarget} = +${increment} charges`);

		const { initialSpent, newSpent, actualGain } = Soul.computeSpentAfterGain(sourceItem, increment);

		if (actualGain === 0) {
			dev.debugLog('info', `${actor.name}: already at full Soul`);
			dev.debugGroupEnd();
			return null;
		}

		const displayBefore = Soul.usesDisplay(sourceItem);
		const displayAfter = `${sourceItem.system.uses.max - newSpent}/${sourceItem.system.uses.max}`;
		await genericUtils.update(sourceItem, { 'system.uses.spent': newSpent });
		undo?.recordItem(sourceItem, initialSpent, newSpent);
		dev.debugLog('success', `${actor.name}: +${actualGain} | ${displayBefore} → ${displayAfter}`);

		dev.debugGroupEnd();
		return `<div class="hbm-row" data-actor-uuid="${actor.uuid}"><span class="hbm-name">${escapeHtml(actor.name)}</span><span class="hbm-resource">${Soul.usesDisplay(sourceItem)}</span><span class="hbm-delta hbm-delta--gain">+${actualGain}</span><span class="hbm-type">${game.i18n.localize('XHM.Chat.Attack')}</span></div>`;
	}

	// ── Target Gain ────────────────────────────────────────────────────────────

	/**
	 * Grants Soul charges to each target that took HP damage.
	 * Resolves all actors synchronously, then applies gains in parallel per actor
	 * (tokens sharing one linked actor are applied in order so their updates don't race).
	 * Targets without a Soul item are silently skipped.
	 * Returns an array of formatted message lines.
	 *
	 * @param {Workflow} workflow
	 * @param {boolean} sectionBlacklisted
	 * @param {import('../core/undo.js').UndoRecorder|null} [undo]
	 * @returns {Promise<string[]>}
	 */
	async _processTargetGain(workflow, sectionBlacklisted, undo = null) {
		dev.debugGroupStart('Target Gain');

		if (!workflow.damageList?.length) {
			dev.debugLog('info', 'No damage list on workflow — skipping');
			dev.debugGroupEnd();
			return [];
		}

		if (sectionBlacklisted) {
			dev.debugLog('warning', 'Section blacklisted — skipping target gain');
			dev.debugGroupEnd();
			return [];
		}

		dev.debugLog(
			'info',
			`Damage list: ${workflow.damageList.length} entr${workflow.damageList.length === 1 ? 'y' : 'ies'}`,
		);

		// ── Resolve all actors (world docs — synchronous) ─────────────────────
		const validTargets = workflow.damageList
			.map((target) => {
				if (!target.isHit || target.hpDamage <= 0) {
					const name = fromUuidSync(target.actorUuid)?.name ?? target.actorUuid;
					dev.debugLog('info', `Skip ${name} — not hit or no HP damage`);
					return null;
				}

				const actor = fromUuidSync(target.actorUuid);
				if (!actor) {
					dev.debugLog('warning', `Could not resolve actor: ${target.actorUuid}`);
					return null;
				}

				return { actor, hpDamage: target.hpDamage };
			})
			.filter(Boolean);

		dev.debugLog('info', `${validTargets.length} valid target${validTargets.length !== 1 ? 's' : ''} to process`);

		// ── Apply gains in parallel per actor; output keeps target order ──────
		const lines = (
			await mapSerialPerKey(
				validTargets,
				({ actor }) => actor.uuid,
				({ actor, hpDamage }) => this._applyDamageTakenGain(actor, hpDamage, undo),
			)
		).filter(Boolean);

		dev.debugGroupEnd();
		return lines;
	}

	// ── Damage-Taken Gain ──────────────────────────────────────────────────────

	/**
	 * Grants a target Soul charges based on HP damage taken.
	 *
	 * @param {Actor} targetActor
	 * @param {number} damageValue
	 * @param {import('../core/undo.js').UndoRecorder|null} [undo]
	 * @returns {Promise<string|null>} The formatted message line, or null if skipped.
	 */
	async _applyDamageTakenGain(targetActor, damageValue, undo = null) {
		const targetItem = targetActor.items.getName('Soul');
		if (!targetItem) return null;

		// Epsilon guards float error (e.g. 35 × 1.2 = 41.99999…) so whole results don't round down.
		const increment = Math.floor(damageValue * getSoulValues().damageTakenRatio + 1e-9);
		dev.debugLog(
			'info',
			`${targetActor.name}: ${Soul.usesDisplay(targetItem)} | ${damageValue} damage → +${increment} charges`,
		);
		const { initialSpent, newSpent, actualGain } = Soul.computeSpentAfterGain(targetItem, increment);

		if (actualGain === 0) {
			dev.debugLog('info', `${targetActor.name}: already at full Soul`);
			return null;
		}

		const displayBefore = Soul.usesDisplay(targetItem);
		const displayAfter = `${targetItem.system.uses.max - newSpent}/${targetItem.system.uses.max}`;
		await genericUtils.update(targetItem, { 'system.uses.spent': newSpent });
		undo?.recordItem(targetItem, initialSpent, newSpent);
		dev.debugLog(
			'success',
			`${targetActor.name}: +${actualGain} from ${damageValue} damage | ${displayBefore} → ${displayAfter}`,
		);

		return `<div class="hbm-row" data-actor-uuid="${targetActor.uuid}"><span class="hbm-name">${escapeHtml(targetActor.name)}</span><span class="hbm-resource">${Soul.usesDisplay(targetItem)}</span><span class="hbm-delta hbm-delta--gain">+${actualGain}</span><span class="hbm-type">${game.i18n.localize('XHM.Chat.Taken')}</span></div>`;
	}

	// ── Long Rest Reset ────────────────────────────────────────────────────────

	/**
	 * Resets an actor's Soul item to full on long rest.
	 * @param {Actor} actor
	 */
	async resetSoul(actor) {
		const item = actor.items.getName('Soul');
		if (!item) return;

		dev.debugLog('info', `${actor.name}: resetting Soul (was ${Soul.usesDisplay(item)})`);
		await genericUtils.update(item, { 'system.uses.spent': item.system.uses.max });
		dev.debugLog('success', `${actor.name}: Soul reset to full`);
	}
}

export const soul = new Soul();

export function isSoul(item) {
	const section = item.flags?.['tidy5e-sheet']?.section ?? null;
	return item.type === 'feat' && (section === 'Soulstrike' || section === 'Soulburst');
}
