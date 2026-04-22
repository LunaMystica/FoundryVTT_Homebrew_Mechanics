// prettier-ignore
const { utils: { genericUtils } } = chrisPremades;

import { dev } from './dev.js';
import { chatLog } from './chatLog.js';

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
	 *
	 * @param {Workflow} workflow
	 */
	async calculateSoul(workflow) {
		dev.debugGroupStart('Soul');
		dev.debugLog('info', `Triggered by ${workflow.actor.name} using "${workflow.item.name}"`);

		if (workflow.hitTargets.size === 0) {
			dev.debugLog('warning', 'No targets hit — aborting');
			dev.debugGroupEnd();
			return;
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

		// Run both independently — neither blocks the other
		await this._processAttackerGain(workflow, itemBlacklisted, sectionBlacklisted);
		await this._processTargetGain(workflow, sectionBlacklisted);

		dev.debugGroupEnd();
	}

	// ── Attacker Gain ──────────────────────────────────────────────────────────

	/**
	 * Grants Soul charges to the attacker: flat 4 for attacks, 3 per target for AoE.
	 * Skipped if the attacker has no Soul item, or if blacklisted.
	 *
	 * @param {Workflow} workflow
	 * @param {boolean} itemBlacklisted
	 * @param {boolean} sectionBlacklisted
	 */
	async _processAttackerGain(workflow, itemBlacklisted, sectionBlacklisted) {
		dev.debugGroupStart('Attacker Gain');

		const actor = workflow.actor;
		const sourceItem = actor.items.getName('Soul');

		if (!sourceItem) {
			dev.debugLog('warning', `${actor.name} has no Soul item — skipping`);
			dev.debugGroupEnd();
			return;
		}

		if (itemBlacklisted || sectionBlacklisted) {
			dev.debugLog('warning', 'Blacklisted — skipping attacker gain');
			dev.debugGroupEnd();
			return;
		}

		const isAoe = !!workflow.templateUuid;
		const increment = isAoe ? workflow.hitTargets.size * 3 : 4;
		dev.debugLog('math', isAoe ? `AoE: ${workflow.hitTargets.size} hit × 3 = +${increment} charges` : `Attack: flat +${increment} charges`);

		const { initialSpent, newSpent, actualGain } = Soul.computeSpentAfterGain(sourceItem, increment);

		if (actualGain === 0) {
			dev.debugLog('info', `${actor.name}: already at full Soul`);
			dev.debugGroupEnd();
			return;
		}

		const displayBefore = Soul.usesDisplay(sourceItem);
		const displayAfter = `${sourceItem.system.uses.max - newSpent}/${sourceItem.system.uses.max}`;
		await genericUtils.update(sourceItem, { 'system.uses.spent': newSpent });
		dev.debugLog('success', `${actor.name}: +${actualGain} | ${displayBefore} → ${displayAfter}`);

		const message = `<b>${actor.name}</b>: ${Soul.usesDisplay(sourceItem)} | (<span style="color:green">+${actualGain}</span>)<hr>`;
		await chatLog.send(`<h3>Soul:</h3><br>${message}`);

		dev.debugGroupEnd();
	}

	// ── Target Gain ────────────────────────────────────────────────────────────

	/**
	 * Grants Soul charges to each target that took HP damage.
	 * Resolves all actors in parallel, then processes sequentially.
	 * Targets without a Soul item are silently skipped.
	 *
	 * @param {Workflow} workflow
	 */
	async _processTargetGain(workflow, sectionBlacklisted) {
		dev.debugGroupStart('Target Gain');

		if (!workflow.damageList?.length) {
			dev.debugLog('info', 'No damage list on workflow — skipping');
			dev.debugGroupEnd();
			return;
		}

		if (sectionBlacklisted) {
			dev.debugLog('warning', 'Section blacklisted — skipping target gain');
			dev.debugGroupEnd();
			return;
		}

		dev.debugLog('info', `Damage list: ${workflow.damageList.length} entr${workflow.damageList.length === 1 ? 'y' : 'ies'}`);

		// ── Resolve all actors in parallel ────────────────────────────────────
		const validTargets = (
			await Promise.all(
				workflow.damageList.map(async (target) => {
					if (!target.isHit || target.hpDamage <= 0) {
						const name = fromUuidSync(target.actorUuid)?.name ?? target.actorUuid;
						dev.debugLog('info', `Skip ${name} — not hit or no HP damage`);
						return null;
					}

					const actor = await fromUuid(target.actorUuid);
					if (!actor) {
						dev.debugLog('warning', `Could not resolve actor: ${target.actorUuid}`);
						return null;
					}

					return { actor, hpDamage: target.hpDamage };
				}),
			)
		).filter(Boolean);

		dev.debugLog('info', `${validTargets.length} valid target${validTargets.length !== 1 ? 's' : ''} to process`);

		// ── Process sequentially (updates must be ordered) ────────────────────
		const chatMessages = [];
		for (const { actor, hpDamage } of validTargets) {
			await this._applyDamageTakenGain(actor, hpDamage, chatMessages);
		}

		if (chatMessages.length > 0) {
			await chatLog.send('<h3>Soul (Damage Taken):</h3><br>' + chatMessages.join('<br>'));
		}

		dev.debugGroupEnd();
	}

	// ── Damage-Taken Gain ──────────────────────────────────────────────────────

	/**
	 * Grants a target Soul charges based on HP damage taken.
	 *
	 * @param {Actor} targetActor
	 * @param {number} damageValue
	 * @param {string[]} chatMessages - Mutated in place; caller sends the batch.
	 */
	async _applyDamageTakenGain(targetActor, damageValue, chatMessages) {
		const targetItem = targetActor.items.getName('Soul');
		if (!targetItem) return;

		const increment = Math.floor((damageValue * 3) / 2.5);
		dev.debugLog('info', `${targetActor.name}: ${Soul.usesDisplay(targetItem)} | ${damageValue} damage → +${increment} charges`);
		const { initialSpent, newSpent, actualGain } = Soul.computeSpentAfterGain(targetItem, increment);

		if (actualGain === 0) {
			dev.debugLog('info', `${targetActor.name}: already at full Soul`);
			return;
		}

		const displayBefore = Soul.usesDisplay(targetItem);
		const displayAfter = `${targetItem.system.uses.max - newSpent}/${targetItem.system.uses.max}`;
		await genericUtils.update(targetItem, { 'system.uses.spent': newSpent });
		dev.debugLog('success', `${targetActor.name}: +${actualGain} from ${damageValue} damage | ${displayBefore} → ${displayAfter}`);

		chatMessages.push(`<b>${targetActor.name}</b>: ${Soul.usesDisplay(targetItem)} | (+<span style="color:green">${actualGain}</span>)`);
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
		await genericUtils.update(item, { 'system.uses.spent': 0 });
		dev.debugLog('success', `${actor.name}: Soul reset to full`);
	}
}

export const soul = new Soul();

export function isSoul(item) {
	const section = item.flags?.['tidy5e-sheet']?.section ?? null;
	return item.type === 'feat' && (section === 'Soulstrike' || section === 'Soulburst');
}
