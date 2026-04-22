// prettier-ignore
const { utils: { activityUtils, effectUtils, genericUtils, workflowUtils } } = chrisPremades;
import { damageTypeFeatures, endurance_broken_effect } from '../../constants/index.js';
import { dev } from './dev.js';
import { chatLog } from './chatLog.js';
import { isSoul } from './soul.js';

class Endurance {
	#chatMessages = [];

	// ── Helpers ────────────────────────────────────────────────────────────────

	static usesDisplay(item) {
		return `${item.system.uses.value}/${item.system.uses.max}`;
	}

	static getEnduranceReduction(item, isCritical = false) {
		let base;
		switch (item.type) {
			case 'weapon':
				base = 1;
				break;

			case 'spell':
				base = item.system.level === 0 ? 2 : 3;
				break;

			case 'feat': {
				const section = item.flags?.['tidy5e-sheet']?.section ?? null;
				if (section === 'Soulstrike') { base = 3; break; }
				if (section === 'Soulburst') { base = 6; break; }
				if (section === 'Weakness Break') { base = 0; break; }
				base = 3;
				break;
			}

			default:
				base = 0;
		}
		return base === 0 ? 0 : base + (isCritical ? 1 : 0);
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

		dev.debugGroupStart(`Endurance — "${workflow.item.name}", ${damageList.length} target${damageList.length !== 1 ? 's' : ''}`);

		// ── Set lastHit flag on hit targets for spells and Soul feats ─────────────
		const combatRound = game.combat?.round ?? null;
		const combatTurn = game.combat?.turn ?? null;
		const alreadyProcessed = new Set();

		const shouldTrackHit = workflow.item.type === 'spell' || isSoul(workflow.item);

		if (shouldTrackHit)
			await Promise.all(
				[...workflow.hitTargets].map(async (token) => {
					const tokenDoc = token.document ?? token;

					const lastHit = tokenDoc.getFlag('xeno-homebrew-mechanics', 'lastHit');
					if (
						lastHit?.itemUuid === workflow.item.uuid &&
						lastHit?.activityUuid === workflow.activity.uuid &&
						lastHit?.round === combatRound &&
						lastHit?.turn === combatTurn
					) {
						alreadyProcessed.add(tokenDoc.uuid);
					}
					await tokenDoc.setFlag('xeno-homebrew-mechanics', 'lastHit', {
						itemUuid: workflow.item.uuid,
						activityUuid: workflow.activity.uuid,
						round: combatRound,
						turn: combatTurn,
					});
					dev.debugLog('info', `Set lastHit for ${tokenDoc.name}`, {
						itemUuid: workflow.item.uuid,
						activityUuid: workflow.activity.uuid,
						round: combatRound,
						turn: combatTurn,
					});
				}),
			);

		if (shouldTrackHit) dev.debugLog('info', `lastHit tracking: ${alreadyProcessed.size} already-processed this turn`);

		// ── Filter valid targets up front, resolving actors in parallel ────────
		const validTargets = (
			await Promise.all(
				damageList.map(async (target) => {
					const name = () => fromUuidSync(target.actorUuid)?.name ?? target.actorUuid;

					if (alreadyProcessed.has(target.targetUuid)) {
						dev.debugLog('info', `Skip ${name()} — already processed this turn`);
						return null;
					}

					if (!target.isHit || workflow.activity.damage.onSave === 'none') {
						dev.debugLog('info', `Skip ${name()} — not hit or no save damage`);
						return null;
					}

					const resolved = await Endurance.resolveTarget(target);
					if (!resolved) {
						dev.debugLog('warning', `Could not resolve actor or endurance item: ${name()}`);
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
		dev.debugLog('info', `${damageType} ${damageAmount} from ${sourceActor.name}`);

		const enduranceItem = actor.items.getName('Endurance');
		if (!enduranceItem) {
			dev.debugGroupEnd();
			throw new Error(`forceBreakEndurance: ${actor.name} has no Endurance item`);
		}

		if (enduranceItem.system.uses.spent >= enduranceItem.system.uses.max) {
			dev.debugLog('info', `${actor.name}: already broken — skipping`);
			dev.debugGroupEnd();
			return;
		}

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

		const isCritical = workflow.isCritical ?? false;
		const reduction = Endurance.getEnduranceReduction(workflow.item, isCritical);
		dev.debugLog('info', `reduction: ${reduction} from "${workflow.item.name}" (${workflow.item.type})${isCritical ? ' [crit +1]' : ''}`);

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
			dev.debugLog('info', `${targetActor.name}: already broken — skipping`);
			dev.debugGroupEnd();
			return;
		}

		dev.debugLog('info', `Current endurance: ${Endurance.usesDisplay(enduranceItem)}`);

		const matchedRoll = workflow.damageRolls.find((roll) => weaknesses.has(roll.options.type));
		if (!matchedRoll) {
			dev.debugLog('info', `${targetActor.name}: no weakness matched — skipping`);
			dev.debugGroupEnd();
			return;
		}

		const damageType = matchedRoll.options.type;
		const initialSpent = enduranceItem.system.uses.spent;
		const newSpent = Math.min(initialSpent + reduction, enduranceItem.system.uses.max);
		const actualReduction = newSpent - initialSpent;
		const broken = newSpent >= enduranceItem.system.uses.max;
		const displayBefore = Endurance.usesDisplay(enduranceItem);
		const displayAfter = `${enduranceItem.system.uses.max - newSpent}/${enduranceItem.system.uses.max}`;

		await genericUtils.update(enduranceItem, { 'system.uses.spent': newSpent });
		dev.debugLog('success', `${targetActor.name}: ${damageType} (-${actualReduction}) | ${displayBefore} → ${displayAfter}${broken ? ' | BROKEN' : ''}`);

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
		await genericUtils.update(enduranceItem, { 'system.uses.spent': enduranceItem.system.uses.max });
		await effectUtils.createEffect(actor, endurance_broken_effect);
		dev.debugLog('success', `${actor.name}: broken effect applied`);
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
			dev.debugLog('warning', `No source item mapped for "${damageType}" — skipping`);
			dev.debugGroupEnd();
			return;
		}

		const sourceItem = await fromUuid(sourceItemUuid);
		if (!sourceItem) {
			dev.debugLog('warning', `Could not resolve source item for "${damageType}" — skipping`);
			dev.debugGroupEnd();
			return;
		}

		const activity = sourceItem.system.activities.values().next().value;
		const activityData = await activityUtils.withChangedDamage(activity, `${damageAmount}`);

		if (!activityData) {
			dev.debugLog('warning', `No activity data for "${sourceItem.name}" — skipping`);
			dev.debugGroupEnd();
			return;
		}

		activityData.target.affects.count = 999;
		if (options.ignoreTraits) {
			activityData.midiProperties ??= {};
			activityData.midiProperties.ignoreTraits = options.ignoreTraits;
		}
		await workflowUtils.syntheticActivityDataRoll(activityData, sourceItem, sourceActor, targetTokens);
		dev.debugLog(
			'success',
			`${damageAmount} ${damageType} → ${targetTokens.length} target${targetTokens.length !== 1 ? 's' : ''} via "${sourceItem.name}"`,
		);

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
		const grouped = Endurance.groupByDamageType(brokenTargets);

		for (const [damageType, targets] of Object.entries(grouped)) {
			const totalDamage = Endurance.totalDamageForType(workflow.damageRolls, damageType);
			await this._fireSyntheticRoll(damageType, totalDamage, workflow.actor, targets);
		}
	}

	// ── Reset ──────────────────────────────────────────────────────────────────

	/**
	 * Resets an actor's Endurance spent to 0.
	 * @param {Actor} actor
	 * @throws {Error} If the actor has no Endurance item.
	 */
	async resetEndurance(actor) {
		const item = actor.items.getName('Endurance');
		if (!item) throw new Error(`resetEndurance: ${actor.name} has no Endurance item`);

		const display = Endurance.usesDisplay(item);
		await genericUtils.update(item, { 'system.uses.spent': 0 });
		dev.debugLog('success', `${actor.name}: ${display} → 0/${item.system.uses.max}`);
	}
}

export const endurance = new Endurance();
