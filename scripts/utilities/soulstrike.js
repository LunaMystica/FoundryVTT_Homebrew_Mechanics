// prettier-ignore
const { utils: { genericUtils } } = chrisPremades;

import { dev } from './dev.js';
import { chatLog } from './chatLog.js';

class Soulstrike {
	// ── Helpers ────────────────────────────────────────────────────────────────

	/**
	 * Returns the display string for a Soulstrike item's current uses.
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
	async calculateSoulstrike(workflow) {
		dev.debugGroupStart('Soulstrike');
		dev.debugLog('info', `Triggered by ${workflow.actor.name} using "${workflow.item.name}"`);

		if (workflow.hitTargets.size === 0) {
			dev.debugLog('warning', 'No targets hit — aborting');
			dev.debugGroupEnd();
			return;
		}

		const itemBlacklist = Soulstrike.getBlacklistSetting('soulstrike-item-blacklist');
		const sectionBlacklist = Soulstrike.getBlacklistSetting('soulstrike-section-blacklist');

		const itemName = workflow.item.name.trimEnd();
		const itemSection = workflow.item.flags?.['tidy5e-sheet']?.section?.trimEnd() ?? null;

		const itemBlacklisted = itemBlacklist.has(itemName);
		const sectionBlacklisted = sectionBlacklist.has(itemSection);

		dev.debugLog('info', `Item: "${itemName}" | Section: "${itemSection ?? 'none'}"`);
		dev.debugLog('info', `Blacklisted — item: ${itemBlacklisted} | section: ${sectionBlacklisted}`);
		dev.debugLog('info', `Targets hit: ${workflow.hitTargets.size}`);

		// Run both independently — neither blocks the other
		await this._processAttackerGain(workflow, itemBlacklisted, sectionBlacklisted);
		await this._processTargetGain(workflow, sectionBlacklisted);

		dev.debugGroupEnd();
	}

	// ── Attacker Gain ──────────────────────────────────────────────────────────

	/**
	 * Grants Soulstrike charges to the attacker: 5 per target hit.
	 * Skipped if the attacker has no Soulstrike item, or if blacklisted.
	 *
	 * @param {Workflow} workflow
	 * @param {boolean} itemBlacklisted
	 * @param {boolean} sectionBlacklisted
	 */
	async _processAttackerGain(workflow, itemBlacklisted, sectionBlacklisted) {
		dev.debugGroupStart('Attacker Gain');

		const actor = workflow.actor;
		const sourceItem = actor.items.getName('Soulstrike');

		if (!sourceItem) {
			dev.debugLog('warning', `${actor.name} has no Soulstrike item — skipping`);
			dev.debugGroupEnd();
			return;
		}

		if (itemBlacklisted || sectionBlacklisted) {
			dev.debugLog('warning', `Blacklisted (item: ${itemBlacklisted}, section: ${sectionBlacklisted}) — no gain`);
			dev.debugGroupEnd();
			return;
		}

		const increment = workflow.hitTargets.size * 5;
		dev.debugLog('math', `Increment: ${workflow.hitTargets.size} hit × 5 = ${increment}`);

		const { initialSpent, newSpent, actualGain } = Soulstrike.computeSpentAfterGain(sourceItem, increment);

		if (actualGain === 0) {
			dev.debugLog('info', `${actor.name} is already at full Soulstrike — no update needed`);
			dev.debugGroupEnd();
			return;
		}

		dev.debugLog('math', `Spent: ${initialSpent} → ${newSpent} (+${actualGain} charges) | ${Soulstrike.usesDisplay(sourceItem)}`);

		await genericUtils.update(sourceItem, { 'system.uses.spent': newSpent });
		dev.debugLog('success', `${actor.name} gained ${actualGain} Soulstrike charge${actualGain !== 1 ? 's' : ''}`);

		const message = `<b>${actor.name}</b>: ${Soulstrike.usesDisplay(sourceItem)} | (<span style="color:green">+${actualGain}</span>)<hr>`;
		await chatLog.send(`<h3>Soulstrike:</h3><br>${message}`);

		dev.debugGroupEnd();
	}

	// ── Target Gain ────────────────────────────────────────────────────────────

	/**
	 * Grants Soulstrike charges to each target that took HP damage.
	 * Resolves all actors in parallel, then processes sequentially.
	 * Targets without a Soulstrike item are silently skipped.
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
			dev.debugLog('warning', `Blacklisted (section) — no gain`);
			dev.debugGroupEnd();
			return;
		}

		dev.debugLog('info', `Damage list has ${workflow.damageList.length} entr${workflow.damageList.length === 1 ? 'y' : 'ies'}`);

		// ── Resolve all actors in parallel ────────────────────────────────────
		const validTargets = (
			await Promise.all(
				workflow.damageList.map(async (target) => {
					if (!target.isHit || target.hpDamage <= 0) {
						dev.debugLog('info', `Skipping ${target.actorUuid} — not hit or no HP damage`);
						return null;
					}

					const actor = await fromUuid(target.actorUuid);
					if (!actor) {
						dev.debugLog('warning', `Could not resolve actor for UUID: ${target.actorUuid}`);
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
			await chatLog.send('<h3>Soulstrike (Damage Taken):</h3><br>' + chatMessages.join('<br>'));
		}

		dev.debugGroupEnd();
	}

	// ── Damage-Taken Gain ──────────────────────────────────────────────────────

	/**
	 * Grants a target Soulstrike charges equal to the HP damage they took.
	 *
	 * @param {Actor} targetActor
	 * @param {number} damageValue
	 * @param {string[]} chatMessages - Mutated in place; caller sends the batch.
	 */
	async _applyDamageTakenGain(targetActor, damageValue, chatMessages) {
		dev.debugGroupStart(`Damage Taken — ${targetActor.name}`);

		const targetItem = targetActor.items.getName('Soulstrike');

		if (!targetItem) {
			dev.debugLog('warning', `${targetActor.name} has no Soulstrike item — skipping`);
			dev.debugGroupEnd();
			return;
		}

		dev.debugLog('info', `Current: ${Soulstrike.usesDisplay(targetItem)} | Incoming damage: ${damageValue}`);

		const { initialSpent, newSpent, actualGain } = Soulstrike.computeSpentAfterGain(targetItem, damageValue);

		if (actualGain === 0) {
			dev.debugLog('info', `${targetActor.name} is already at full Soulstrike — no update needed`);
			dev.debugGroupEnd();
			return;
		}

		dev.debugLog('math', `Spent: ${initialSpent} → ${newSpent} (+${actualGain} charges) | ${Soulstrike.usesDisplay(targetItem)}`);

		await genericUtils.update(targetItem, { 'system.uses.spent': newSpent });
		dev.debugLog('success', `${targetActor.name} gained ${actualGain} Soulstrike charge${actualGain !== 1 ? 's' : ''} from damage taken`);

		chatMessages.push(`<b>${targetActor.name}</b>: ${Soulstrike.usesDisplay(targetItem)} | (+<span style="color:green">${actualGain}</span>)`);

		dev.debugGroupEnd();
	}
}

export const soulstrike = new Soulstrike();

export function isSoulstrike(item) {
	const section = item.flags?.['tidy5e-sheet']?.section ?? null;
	return item.type === 'feat' && (section === 'Soulstrike Move' || section === 'Soulstrike Burst');
}
