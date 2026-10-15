// prettier-ignore
const { utils: { activityUtils, effectUtils, genericUtils, workflowUtils } } = chrisPremades;
import { endurance_broken_effect } from './effects.js';
import { dev } from '../core/dev.js';
import { chatLog } from '../core/chat-log.js';
import { isSoul } from '../soul/soul.js';
import { mapSerialPerKey } from '../core/async-utils.js';
import { escapeHtml } from '../core/html.js';
import { UndoRecorder } from '../core/undo.js';
import { getEnduranceMode, getEnduranceReduction } from '../values/values.js';
import { playBreakFx } from './break-fx.js';

class Endurance {
	#chatMessages = [];

	// ── Helpers ────────────────────────────────────────────────────────────────

	static usesDisplay(item) {
		return `${item.system.uses.value}/${item.system.uses.max}`;
	}

	/**
	 * Endurance lost when `item` hits a weakness. Values come from the
	 * **Endurance & Soul Values** menu, or the item's override flag.
	 * @param {Item} item
	 * @param {boolean} [isCritical=false]
	 * @returns {number}
	 */
	static getEnduranceReduction(item, isCritical = false) {
		return getEnduranceReduction(item, isCritical);
	}

	/**
	 * Picks the damage roll that drives Endurance for this target, or null if none qualifies.
	 * A roll matching a weakness always wins. Otherwise, depending on the item's mode:
	 * `ignoreWeakness` takes the first roll the target doesn't resist / isn't immune to;
	 * `bypass` takes the first damage roll regardless.
	 *
	 * @param {Roll[]} damageRolls
	 * @param {Actor} actor
	 * @param {'weakness'|'ignoreWeakness'|'bypass'} mode
	 * @returns {Roll|null}
	 */
	static pickDamageRoll(damageRolls, actor, mode) {
		const traits = actor.system.traits ?? {};
		const damageTypes = CONFIG.DND5E?.damageTypes ?? {};
		const rolls = (damageRolls ?? []).filter((roll) => roll.options?.type in damageTypes);
		const weaknesses = new Set(traits.dv?.value ?? []);

		const weak = rolls.find((roll) => weaknesses.has(roll.options.type));
		if (weak || mode === 'weakness') return weak ?? null;
		if (mode === 'bypass') return rolls[0] ?? null;

		const blocked = new Set([...(traits.dr?.value ?? []), ...(traits.di?.value ?? [])]);
		return rolls.find((roll) => !blocked.has(roll.options.type)) ?? null;
	}

	static groupByDamageType(brokenTargets) {
		return brokenTargets.reduce((acc, { target, damageType }) => {
			(acc[damageType] ??= []).push(target);
			return acc;
		}, {});
	}

	static totalDamageForType(damageRolls, damageType) {
		return damageRolls
			.filter((roll) => roll.options.type === damageType)
			.reduce((sum, roll) => sum + roll.total, 0);
	}

	/**
	 * Resolves an actor and their endurance item from a damage target entry.
	 * Returns null if either cannot be resolved or the actor is not hit.
	 * @param {Object} target
	 * @returns {{ actor: Actor, enduranceItem: Item } | null}
	 */
	static resolveTarget(target) {
		const actor = fromUuidSync(target.actorUuid);
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
	 * @param {UndoRecorder|null} [undo] - Collects changes for the chat card's Undo button.
	 */
	async checkEndurance(damageList, workflow, undo = null) {
		this.#chatMessages = [];

		dev.debugGroupStart(
			`Endurance — "${workflow.item.name}", ${damageList.length} target${damageList.length !== 1 ? 's' : ''}`,
		);

		// ── Set lastHit flag on hit targets for spells and Soul feats ─────────────
		const combatRound = game.combat?.round ?? null;
		const combatTurn = game.combat?.turn ?? null;
		const alreadyProcessed = new Set();

		// Multihit tracking only makes sense in combat — outside combat, round/turn are null
		// and every repeat hit would falsely match. Let all hits through instead.
		const shouldTrackHit = !!game.combat && (workflow.item.type === 'spell' || isSoul(workflow.item));

		if (shouldTrackHit)
			await Promise.all(
				[...workflow.hitTargets].map(async (token) => {
					const tokenDoc = token.document ?? token;

					const lastHit = tokenDoc.getFlag('xeno-homebrew-mechanics', 'lastHit');
					undo?.recordFlag(tokenDoc, 'lastHit', lastHit);
					if (
						lastHit?.itemUuid === workflow.item.uuid &&
						lastHit?.activityUuid === workflow.activity.uuid &&
						lastHit?.round === combatRound &&
						lastHit?.turn === combatTurn
					) {
						alreadyProcessed.add(tokenDoc.uuid);
					}
					await genericUtils.update(tokenDoc, {
						flags: {
							'xeno-homebrew-mechanics': {
								lastHit: {
									itemUuid: workflow.item.uuid,
									activityUuid: workflow.activity.uuid,
									round: combatRound,
									turn: combatTurn,
								},
							},
						},
					});
					dev.debugLog('info', `Set lastHit for ${tokenDoc.name}`, {
						itemUuid: workflow.item.uuid,
						activityUuid: workflow.activity.uuid,
						round: combatRound,
						turn: combatTurn,
					});
				}),
			);

		if (shouldTrackHit)
			dev.debugLog('info', `lastHit tracking: ${alreadyProcessed.size} already-processed this turn`);

		// ── Filter valid targets up front (actors are world docs — synchronous) ─
		const validTargets = damageList
			.map((target) => {
				const name = () => fromUuidSync(target.actorUuid)?.name ?? target.actorUuid;

				if (alreadyProcessed.has(target.targetUuid)) {
					dev.debugLog('info', `Skip ${name()} — already processed this turn`);
					return null;
				}

				// midi lists missed targets too (isHit false), sometimes with damage still
				// calculated (e.g. damage-on-miss); only hits wear down Endurance.
				if (target.isHit === false || target.wasHit === false) {
					dev.debugLog('info', `Skip ${name()} — missed`);
					return null;
				}

				const tookDamage = (target.hpDamage ?? 0) > 0 || (target.appliedDamage ?? 0) > 0;
				if (!tookDamage) {
					dev.debugLog('info', `Skip ${name()} — took no damage`);
					return null;
				}

				const resolved = Endurance.resolveTarget(target);
				if (!resolved) {
					dev.debugLog('warning', `Could not resolve actor or endurance item: ${name()}`);
					return null;
				}

				return { ...resolved, target };
			})
			.filter(Boolean);

		dev.debugLog('info', `${validTargets.length} valid target${validTargets.length !== 1 ? 's' : ''} to process`);

		// ── Process actors in parallel; tokens sharing an actor run in order ──
		// (two tokens of one linked actor share its Endurance item, so their updates must not race)
		const results = await mapSerialPerKey(
			validTargets,
			({ actor }) => actor.uuid,
			({ actor, enduranceItem, target }) => {
				dev.debugLog('info', `Processing ${actor.name} (${target.hpDamage} HP damage)`);
				return this._updateEndurance(actor, enduranceItem, target, workflow, undo);
			},
		);

		const brokenTargets = [];
		for (const result of results) {
			if (!result) continue;
			this.#chatMessages.push(result.line);
			if (result.broken) brokenTargets.push(result.broken);
		}

		dev.debugLog(
			'info',
			`Pass complete — ${brokenTargets.length} broken target${brokenTargets.length !== 1 ? 's' : ''}`,
		);

		const sectionHtml =
			this.#chatMessages.length > 0
				? `<div class="hbm-section-header hbm-section-header--endurance">${game.i18n.localize('XHM.Chat.Endurance')}</div>${this.#chatMessages.join('')}`
				: null;

		if (brokenTargets.length > 0) {
			await this._processBrokenTargets(brokenTargets, workflow, undo);
		} else {
			dev.debugLog('info', 'No broken targets — done');
		}

		dev.debugGroupEnd();
		return sectionHtml;
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
		const targetToken = this._resolveActorToken(actor);
		if (!targetToken) {
			dev.debugGroupEnd();
			throw new Error(`forceBreakEndurance: no active token found for ${actor.name}`);
		}

		// ── Break endurance and fire damage roll in parallel ───────────────────
		const undo = new UndoRecorder();
		await Promise.all([
			this._applyBreak(actor, enduranceItem, targetToken, undo),
			this._fireSyntheticRoll(
				damageType,
				damageAmount,
				sourceActor,
				[targetToken],
				{ ignoreTraits: ['idr', 'idv', 'idi', 'idm', 'ida'] },
				undo,
			),
		]);

		const message = `<div class="hbm-card"><div class="hbm-section-header hbm-section-header--endurance">${game.i18n.localize('XHM.Chat.Endurance')}</div><div class="hbm-row" data-actor-uuid="${actor.uuid}"><span class="hbm-name">${escapeHtml(actor.name)}</span><span class="hbm-resource">0/${enduranceItem.system.uses.max}</span><span class="hbm-type">${damageType}</span><span class="hbm-broken">${game.i18n.localize('XHM.Chat.ForceBroken')}</span></div></div>`;
		await chatLog.send(message, { undo });

		dev.debugGroupEnd();
	}

	// ── Endurance Update ───────────────────────────────────────────────────────

	/**
	 * Updates endurance for a single target. If a weakness match is found and
	 * reduction causes endurance to break, applies the broken effect and reports it.
	 *
	 * @param {Actor} targetActor
	 * @param {Item} enduranceItem - Pre-resolved endurance item for the actor.
	 * @param {Object} target - The damage target entry from the workflow.
	 * @param {Workflow} workflow
	 * @param {UndoRecorder|null} [undo]
	 * @returns {Promise<{ line: string, broken: { target: Token, damageType: string } | null } | null>}
	 *   The chat-row line plus any break info, or null if the target was skipped.
	 */
	async _updateEndurance(targetActor, enduranceItem, target, workflow, undo = null) {
		dev.debugGroupStart(`Update — ${targetActor.name}`);

		const isCritical = workflow.isCritical ?? false;
		const reduction = Endurance.getEnduranceReduction(workflow.item, isCritical);
		dev.debugLog(
			'info',
			`reduction: ${reduction} from "${workflow.item.name}" (${workflow.item.type})${isCritical ? ' [crit]' : ''}`,
		);

		if (reduction === 0) {
			dev.debugLog('warning', 'Reduction is 0 — skipping');
			dev.debugGroupEnd();
			return null;
		}

		const mode = getEnduranceMode(workflow.item);
		const weaknesses = new Set(targetActor.system.traits.dv.value);
		if (weaknesses.size === 0 && mode === 'weakness') {
			dev.debugLog('info', `${targetActor.name} has no weaknesses — skipping`);
			dev.debugGroupEnd();
			return null;
		}

		dev.debugLog('info', `Weaknesses: [${Array.from(weaknesses).join(', ')}] | mode: ${mode}`);

		if (enduranceItem.system.uses.spent >= enduranceItem.system.uses.max) {
			dev.debugLog('info', `${targetActor.name}: already broken — skipping`);
			dev.debugGroupEnd();
			return null;
		}

		dev.debugLog('info', `Current endurance: ${Endurance.usesDisplay(enduranceItem)}`);

		const matchedRoll = Endurance.pickDamageRoll(workflow.damageRolls, targetActor, mode);
		if (!matchedRoll) {
			const reason = mode === 'weakness' ? 'no weakness matched' : 'all damage resisted or immune';
			dev.debugLog('info', `${targetActor.name}: ${reason} — skipping`);
			dev.debugGroupEnd();
			return null;
		}

		const damageType = matchedRoll.options.type;
		const initialSpent = enduranceItem.system.uses.spent;
		const newSpent = Math.min(initialSpent + reduction, enduranceItem.system.uses.max);
		const actualReduction = newSpent - initialSpent;
		const broken = newSpent >= enduranceItem.system.uses.max;
		const displayBefore = Endurance.usesDisplay(enduranceItem);
		const displayAfter = `${enduranceItem.system.uses.max - newSpent}/${enduranceItem.system.uses.max}`;
		dev.debugLog(
			'info',
			`${targetActor.name}: ${damageType} (-${actualReduction}) | ${displayBefore} → ${displayAfter}${broken ? ' | BROKEN' : ''}`,
		);

		// Close the group before awaiting: targets run in parallel, so a group left
		// open across an await would swallow other targets' logs.
		dev.debugGroupEnd();

		await genericUtils.update(enduranceItem, { 'system.uses.spent': newSpent });
		undo?.recordItem(enduranceItem, initialSpent, newSpent);
		dev.debugLog('success', `${targetActor.name}: endurance updated to ${displayAfter}`);

		let brokenInfo = null;
		if (broken) {
			const targetTokenDocument = fromUuidSync(target.targetUuid);
			const targetToken = canvas.tokens.get(targetTokenDocument.id);
			brokenInfo = { target: targetToken, damageType };
			await this._applyBreak(targetActor, enduranceItem, targetToken, undo);
		}

		const brokenBadge = broken ? ` <span class="hbm-broken">${game.i18n.localize('XHM.Chat.Broken')}</span>` : '';
		const line = `<div class="hbm-row" data-actor-uuid="${targetActor.uuid}"><span class="hbm-name">${escapeHtml(targetActor.name)}</span><span class="hbm-resource">${Endurance.usesDisplay(enduranceItem)}</span><span class="hbm-delta hbm-delta--loss">−${actualReduction}</span><span class="hbm-type">${damageType}</span>${brokenBadge}</div>`;

		return { line, broken: brokenInfo };
	}

	// ── Break Helpers ──────────────────────────────────────────────────────────

	/**
	 * Maxes out an endurance item's spent value, applies the broken effect and
	 * plays the break FX. Shared between normal break flow and forceBreakEndurance.
	 *
	 * @param {Actor} actor
	 * @param {Item} enduranceItem
	 * @param {Token|null} token - The token to play the break FX on.
	 * @param {UndoRecorder|null} [undo]
	 */
	async _applyBreak(actor, enduranceItem, token, undo = null) {
		const spentBefore = enduranceItem.system.uses.spent;
		const max = enduranceItem.system.uses.max;
		const [, effect] = await Promise.all([
			genericUtils.update(enduranceItem, { 'system.uses.spent': max }),
			effectUtils.createEffect(actor, endurance_broken_effect),
		]);
		undo?.recordItem(enduranceItem, spentBefore, max);
		undo?.recordEffect(effect);
		dev.debugLog('success', `${actor.name}: broken effect applied`);
		playBreakFx(token);
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
	 * @param {{ ignoreTraits?: string[] }} [options]
	 * @param {UndoRecorder|null} [undo] - Captures the roll's HP damage, effects and chat card.
	 */
	async _fireSyntheticRoll(damageType, damageAmount, sourceActor, targetTokens, options = {}, undo = null) {
		dev.debugGroupStart(`Synthetic Roll — ${damageType}`);

		const damageItems = game.settings.get('xeno-homebrew-mechanics', 'endurance-damage-items');
		const sourceItemUuid = damageItems[damageType];
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
		const targetActors = [...new Set(targetTokens.map((t) => t?.actor).filter(Boolean))];
		const stopCapture = undo?.capture(
			targetActors,
			(message) =>
				message.speaker?.actor === sourceActor.id &&
				(message.flags?.dnd5e?.item?.id === sourceItem.id ||
					message.flags?.dnd5e?.activity?.id === activityData._id),
		);
		try {
			await workflowUtils.syntheticActivityDataRoll(activityData, sourceItem, sourceActor, targetTokens);
		} finally {
			stopCapture?.();
		}
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
	_resolveActorToken(actor) {
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

	async _processBrokenTargets(brokenTargets, workflow, undo = null) {
		const grouped = Endurance.groupByDamageType(brokenTargets);

		for (const [damageType, targets] of Object.entries(grouped)) {
			const totalDamage = Endurance.totalDamageForType(workflow.damageRolls, damageType);
			await this._fireSyntheticRoll(damageType, totalDamage, workflow.actor, targets, {}, undo);
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
