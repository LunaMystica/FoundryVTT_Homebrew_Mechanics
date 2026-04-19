// prettier-ignore
const { utils: { activityUtils, effectUtils, genericUtils, workflowUtils } } = chrisPremades;
import { damageTypeFeatures, endurance_broken_effect } from '../../constants/index.js';
import { dev } from './dev.js';
import { chatLog } from './chatLog.js';

class Endurance {
	#chatMessages = [];

	// ── Helpers ────────────────────────────────────────────────────────────────

	static usesDisplay(item) {
		return `${item.system.uses.value}/${item.system.uses.max}`;
	}

	static getEnduranceReduction(item) {
		switch (item.type) {
			case 'weapon':
				return 20;

			case 'spell':
				return item.name === 'Elemental Bullet' || item.name === 'Sacred Bolt' ? 5 : 40;

			case 'feat': {
				const section = item.flags?.['tidy5e-sheet']?.section ?? null;
				if (section === 'Soulstrike Move') return 40;
				if (section === 'Soulstrike Burst') return 80;
				if (section === 'Weakness Break') return 0;
				return 40;
			}

			default:
				return 0;
		}
	}

	static groupByDamageType(brokenTargets) {
		return brokenTargets.reduce((acc, { target, damageType }) => {
			(acc[damageType] ??= []).push(target);
			return acc;
		}, {});
	}

	static totalDamageForType(damageRolls, damageType) {
		return damageRolls.filter((roll) => roll.options.type === damageType).reduce((sum, roll) => sum + roll.total, 0);
	}

	/**
	 * Resolves an actor and their endurance item from a damage target entry.
	 * Returns null if either cannot be resolved or the actor is not hit.
	 * @param {Object} target
	 * @returns {Promise<{ actor: Actor, enduranceItem: Item } | null>}
	 */
	static async resolveTarget(target) {
		const actor = await fromUuid(target.actorUuid);
		if (!actor) return null;

		const enduranceItem = actor.items.getName('Endurance');
		if (!enduranceItem) return null;

		return { actor, enduranceItem };
	}

	// ── Entry Point ────────────────────────────────────────────────────────────

	/**
	 * Main entry point. Iterates over the damage list, updates endurance for each
	 * valid target, then processes any targets whose endurance broke.
	 *
	 * @param {Object[]} damageList - The list of damage targets from the workflow.
	 * @param {Workflow} workflow - The MidiQOL workflow that triggered the hit.
	 */
	async checkEndurance(damageList, workflow) {
		this.#chatMessages = ['<h3>Endurance:</h3>'];

		dev.debugGroupStart('Endurance');
		dev.debugLog('info', `Triggered by "${workflow.item.name}" — ${damageList.length} damage target${damageList.length !== 1 ? 's' : ''}`);

		// ── Filter valid targets up front, resolving actors in parallel ────────
		const validTargets = (
			await Promise.all(
				damageList.map(async (target) => {
					if (!target.isHit || workflow.activity.damage.onSave === 'none') {
						dev.debugLog('info', `Skipping ${target.actorUuid} — not hit or damage on save is none`);
						return null;
					}

					const resolved = await Endurance.resolveTarget(target);
					if (!resolved) {
						dev.debugLog('warning', `Could not resolve actor or endurance item for UUID: ${target.actorUuid}`);
						return null;
					}

					return { ...resolved, target };
				}),
			)
		).filter(Boolean);

		dev.debugLog('info', `${validTargets.length} valid target${validTargets.length !== 1 ? 's' : ''} to process`);

		// ── Process each valid target sequentially (updates must be ordered) ───
		const brokenTargets = [];
		for (const { actor, enduranceItem, target } of validTargets) {
			dev.debugLog('info', `Processing ${actor.name} (${target.hpDamage} HP damage)`);
			await this._updateEndurance(actor, enduranceItem, target, workflow, brokenTargets);
		}

		dev.debugLog('info', `Pass complete — ${brokenTargets.length} broken target${brokenTargets.length !== 1 ? 's' : ''}`);

		if (this.#chatMessages.length > 1) {
			await chatLog.send(this.#chatMessages.join('<br>'));
		}

		if (brokenTargets.length > 0) {
			await this._processBrokenTargets(brokenTargets, workflow, damageTypeFeatures);
		} else {
			dev.debugLog('info', 'No broken targets — done');
		}

		dev.debugGroupEnd();
	}

	// ── Force Break (Public) ───────────────────────────────────────────────────

	/**
	 * Instantly breaks an actor's endurance, applies the broken effect,
	 * and fires a synthetic damage roll for the given damage type and amount.
	 *
	 * @param {Actor} actor - The actor whose endurance to break.
	 * @param {string} damageType - The damage type to use (e.g. "fire", "cold").
	 * @param {number} damageAmount - The damage amount to deal on break.
	 * @param {Actor} sourceActor - The actor dealing the break (used for the synthetic roll).
	 * @throws {Error} If the actor has no Endurance item.
	 */
	async forceBreakEndurance(actor, damageType, damageAmount, sourceActor) {
		dev.debugGroupStart(`Force Break — ${actor.name}`);
		dev.debugLog('info', `type="${damageType}", damage=${damageAmount}, source="${sourceActor.name}"`);

		const enduranceItem = actor.items.getName('Endurance');
		if (!enduranceItem) {
			dev.debugGroupEnd();
			throw new Error(`forceBreakEndurance: ${actor.name} has no Endurance item`);
		}

		if (enduranceItem.system.uses.spent >= enduranceItem.system.uses.max) {
			dev.debugLog('info', `${actor.name}'s endurance is already broken — skipping`);
			dev.debugGroupEnd();
			return;
		}

		dev.debugLog('info', `Current endurance: ${Endurance.usesDisplay(enduranceItem)}`);

		// ── Resolve token before any async mutations ───────────────────────────
		const targetToken = await this._resolveActorToken(actor);
		if (!targetToken) {
			dev.debugGroupEnd();
			throw new Error(`forceBreakEndurance: no active token found for ${actor.name}`);
		}

		// ── Break endurance and fire damage roll in parallel ───────────────────
		await Promise.all([
			this._applyBreak(actor, enduranceItem, damageType, null),
			this._fireSyntheticRoll(damageType, damageAmount, sourceActor, [targetToken], { ignoreTraits: ['idr', 'idv', 'idi', 'idm', 'ida'] }),
		]);

		const message = `<h3>Endurance:</h3><br><b>${actor.name}</b>: 0/${enduranceItem.system.uses.max} | (<span style="color:red">FORCE BROKEN</span>) | ${damageType}`;
		await chatLog.send(message);

		dev.debugGroupEnd();
	}

	// ── Endurance Update ───────────────────────────────────────────────────────

	/**
	 * Updates endurance for a single target. If a weakness match is found and
	 * reduction causes endurance to break, pushes the target onto brokenTargets.
	 *
	 * @param {Actor} targetActor
	 * @param {Item} enduranceItem - Pre-resolved endurance item for the actor.
	 * @param {Object} target - The damage target entry from the workflow.
	 * @param {Workflow} workflow
	 * @param {Array<{ target: Token, damageType: string }>} brokenTargets - Mutated in place.
	 */
	async _updateEndurance(targetActor, enduranceItem, target, workflow, brokenTargets) {
		dev.debugGroupStart(`Update — ${targetActor.name}`);

		const reduction = Endurance.getEnduranceReduction(workflow.item);
		dev.debugLog('math', `"${workflow.item.name}" (${workflow.item.type}) → reduction: ${reduction}`);

		if (reduction === 0) {
			dev.debugLog('warning', 'Reduction is 0 — skipping');
			dev.debugGroupEnd();
			return;
		}

		const weaknesses = new Set(targetActor.system.traits.dv.value);
		if (weaknesses.size === 0) {
			dev.debugLog('info', `${targetActor.name} has no weaknesses — skipping`);
			dev.debugGroupEnd();
			return;
		}

		dev.debugLog('info', `Weaknesses: [${Array.from(weaknesses).join(', ')}]`);

		if (enduranceItem.system.uses.spent >= enduranceItem.system.uses.max) {
			dev.debugLog('info', `${targetActor.name}'s endurance is already broken — skipping`);
			dev.debugGroupEnd();
			return;
		}

		dev.debugLog('info', `Current endurance: ${Endurance.usesDisplay(enduranceItem)}`);

		const matchedRoll = workflow.damageRolls.find((roll) => weaknesses.has(roll.options.type));
		if (!matchedRoll) {
			dev.debugLog('info', 'No damage type matched a weakness — skipping');
			dev.debugGroupEnd();
			return;
		}

		const damageType = matchedRoll.options.type;
		dev.debugLog('info', `Weakness match: "${damageType}" (${matchedRoll.total} damage)`);

		const initialSpent = enduranceItem.system.uses.spent;
		const newSpent = Math.min(initialSpent + reduction, enduranceItem.system.uses.max);
		const actualReduction = newSpent - initialSpent;
		const broken = newSpent >= enduranceItem.system.uses.max;

		dev.debugLog('math', `Spent: ${initialSpent} → ${newSpent} (-${actualReduction}) | broken: ${broken}`);

		await genericUtils.update(enduranceItem, { 'system.uses.spent': newSpent });
		dev.debugLog('success', `${targetActor.name} endurance updated`);

		if (broken) {
			const targetTokenDocument = await fromUuid(target.targetUuid);
			const targetToken = canvas.tokens.get(targetTokenDocument.id);
			brokenTargets.push({ target: targetToken, damageType });
			await this._applyBreak(targetActor, enduranceItem, damageType, null);
		}

		const statusSuffix = broken ? ' <strong>(BROKEN)</strong>' : '';
		this.#chatMessages.push(
			`<b>${targetActor.name}</b>: ${Endurance.usesDisplay(enduranceItem)} | (<span style="color:red">-${actualReduction}</span>) | ${damageType}${statusSuffix}`,
		);

		dev.debugGroupEnd();
	}

	// ── Break Helpers ──────────────────────────────────────────────────────────

	/**
	 * Maxes out an endurance item's spent value and applies the broken effect.
	 * Shared between normal break flow and forceBreakEndurance.
	 *
	 * @param {Actor} actor
	 * @param {Item} enduranceItem
	 * @param {string} damageType - For logging only.
	 * @param {string|null} chatMessageSuffix - Extra text to append to the chat entry, or null.
	 */
	async _applyBreak(actor, enduranceItem, damageType, chatMessageSuffix) {
		dev.debugGroupStart(`Apply Break — ${actor.name}`);

		await genericUtils.update(enduranceItem, { 'system.uses.spent': enduranceItem.system.uses.max });
		dev.debugLog('success', `${actor.name}'s endurance maxed — broken`);

		await effectUtils.createEffect(actor, endurance_broken_effect);
		dev.debugLog('info', 'Applied broken endurance effect');

		dev.debugGroupEnd();
	}

	/**
	 * Fires a synthetic damage roll for a set of tokens using the source item
	 * mapped to the given damage type. Logs a warning and skips gracefully if
	 * no mapping exists.
	 *
	 * @param {string} damageType
	 * @param {number} damageAmount
	 * @param {Actor} sourceActor
	 * @param {Token[]} targetTokens
	 */
	async _fireSyntheticRoll(damageType, damageAmount, sourceActor, targetTokens, options = {}) {
		dev.debugGroupStart(`Synthetic Roll — ${damageType}`);

		const sourceItemUuid = damageTypeFeatures[damageType];
		if (!sourceItemUuid) {
			dev.debugLog('warning', `No source item mapped for damage type "${damageType}" — skipping`);
			dev.debugGroupEnd();
			return;
		}

		const sourceItem = await fromUuid(sourceItemUuid);
		if (!sourceItem) {
			dev.debugLog('warning', `Could not resolve source item UUID for "${damageType}" — skipping`);
			dev.debugGroupEnd();
			return;
		}

		dev.debugLog(
			'info',
			`Source item: "${sourceItem.name}" — ${damageAmount} ${damageType} damage to ${targetTokens.length} target${targetTokens.length !== 1 ? 's' : ''}`,
		);

		const activity = sourceItem.system.activities.values().next().value;
		const activityData = await activityUtils.withChangedDamage(activity, `${damageAmount}`);

		if (!activityData) {
			dev.debugLog('warning', `No activity data returned for "${sourceItem.name}" — skipping`);
			dev.debugGroupEnd();
			return;
		}

		activityData.target.affects.count = 999;
		if (options.ignoreTraits) {
			activityData.midiProperties ??= {};
			activityData.midiProperties.ignoreTraits = options.ignoreTraits;
		}
		await workflowUtils.syntheticActivityDataRoll(activityData, sourceItem, sourceActor, targetTokens);
		dev.debugLog('success', `Synthetic roll fired`);

		dev.debugGroupEnd();
	}

	/**
	 * Resolves the first active canvas token for an actor.
	 * @param {Actor} actor
	 * @returns {Token | null}
	 */
	async _resolveActorToken(actor) {
		const tokens = actor.getActiveTokens();
		if (tokens.length === 0) {
			dev.debugLog('warning', `No active tokens found for ${actor.name}`);
			return null;
		}
		if (tokens.length > 1) {
			dev.debugLog('warning', `Multiple active tokens for ${actor.name} — using first`);
		}
		return tokens[0];
	}

	// ── Broken Target Processing ───────────────────────────────────────────────

	async _processBrokenTargets(brokenTargets, workflow) {
		dev.debugGroupStart('Broken Targets');

		const grouped = Endurance.groupByDamageType(brokenTargets);
		dev.debugLog('info', `Damage types to process: [${Object.keys(grouped).join(', ')}]`);

		for (const [damageType, targets] of Object.entries(grouped)) {
			const totalDamage = Endurance.totalDamageForType(workflow.damageRolls, damageType);
			dev.debugLog('math', `Total ${damageType} damage: ${totalDamage} across ${targets.length} target${targets.length !== 1 ? 's' : ''}`);
			await this._fireSyntheticRoll(damageType, totalDamage, workflow.actor, targets);
		}

		dev.debugGroupEnd();
	}

	// ── Reset ──────────────────────────────────────────────────────────────────

	/**
	 * Resets an actor's Endurance spent to 0.
	 * @param {Actor} actor
	 * @throws {Error} If the actor has no Endurance item.
	 */
	async resetEndurance(actor) {
		dev.debugGroupStart(`Reset — ${actor.name}`);

		const item = actor.items.getName('Endurance');
		if (!item) {
			dev.debugGroupEnd();
			throw new Error(`resetEndurance: ${actor.name} has no Endurance item`);
		}

		dev.debugLog('info', `Resetting endurance: ${Endurance.usesDisplay(item)} → 0/${item.system.uses.max}`);
		await genericUtils.update(item, { 'system.uses.spent': 0 });
		dev.debugLog('success', `${actor.name}'s endurance reset`);

		dev.debugGroupEnd();
	}
}

export const endurance = new Endurance();
