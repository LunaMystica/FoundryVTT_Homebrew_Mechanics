import { dev } from './dev.js';

const MODULE_ID = 'xeno-homebrew-mechanics';

/** Flag set on a broken effect just before an undo deletes it, so its onDelete macro skips the reset. */
export const UNDO_EFFECT_FLAG = 'undoing';

/** Flag on chat messages recreated by Apply, so clients move them back to their original position. */
const RESTORED_FLAG = 'restored';

/**
 * Collects the changes one automation pass makes so a GM can revert (and
 * re-apply) them from the chat card.
 *
 * - Item `uses.spent` and actor HP are stored as before/after values and
 *   reverted as deltas, so later changes to the same document are preserved.
 * - Effects and chat messages created during the pass are deleted on undo; their
 *   data is stashed on the card so **Apply** can recreate them with the same IDs.
 */
export class UndoRecorder {
	/** @type {{ uuid: string, before: number, after: number }[]} */
	items = [];
	/** @type {string[]} */
	effects = [];
	/** @type {{ uuid: string, key: string, previous: unknown }[]} */
	flags = [];
	/** @type {{ uuid: string, value: number, temp: number }[]} HP deltas (after − before). */
	hp = [];
	/** @type {string[]} */
	messages = [];

	/**
	 * @param {Item} item
	 * @param {number} before - `system.uses.spent` before the change.
	 * @param {number} after - `system.uses.spent` after the change.
	 */
	recordItem(item, before, after) {
		if (before !== after) this.items.push({ uuid: item.uuid, before, after });
	}

	/** @param {ActiveEffect|null|undefined} effect */
	recordEffect(effect) {
		if (effect?.uuid && !this.effects.includes(effect.uuid)) this.effects.push(effect.uuid);
	}

	/** @param {ChatMessage|null|undefined} message */
	recordMessage(message) {
		if (message?.uuid && !this.messages.includes(message.uuid)) this.messages.push(message.uuid);
	}

	/**
	 * Records a module flag's previous value (undefined = was unset).
	 * @param {Document} doc
	 * @param {string} key
	 * @param {unknown} previous
	 */
	recordFlag(doc, key, previous) {
		this.flags.push({ uuid: doc.uuid, key, previous: previous ?? null });
	}

	/**
	 * Captures everything a synthetic roll does to `actors`: HP changes, effects
	 * created on them, and chat messages matching `messageFilter`. Call the
	 * returned function once the roll has finished.
	 *
	 * @param {Actor[]} actors
	 * @param {(message: ChatMessage) => boolean} messageFilter
	 * @returns {() => void} stop
	 */
	capture(actors, messageFilter) {
		const uuids = new Set(actors.map((a) => a.uuid));
		const snapshot = new Map(actors.map((a) => [a.uuid, UndoRecorder.#readHp(a)]));
		const onEffect = (effect) => {
			// dnd5e's own condition effects (static IDs like "dnd5eprone000000") come and go with
			// the break effects themselves; leave them to dnd5e instead of undoing them separately.
			if (effect.id?.startsWith('dnd5e')) return;
			if (uuids.has(effect.parent?.uuid)) this.recordEffect(effect);
		};
		const onMessage = (message) => {
			if (message.speaker?.alias === 'HBM') return;
			// Follow-up cards (e.g. a separate damage roll) point back at the usage card.
			const origin = message.flags?.dnd5e?.originatingMessage;
			const isFollowUp = origin && this.messages.includes(`ChatMessage.${origin}`);
			if (isFollowUp || messageFilter(message)) this.recordMessage(message);
		};
		const effectHook = Hooks.on('createActiveEffect', onEffect);
		const messageHook = Hooks.on('createChatMessage', onMessage);

		return () => {
			Hooks.off('createActiveEffect', effectHook);
			Hooks.off('createChatMessage', messageHook);
			for (const actor of actors) {
				const before = snapshot.get(actor.uuid);
				const after = UndoRecorder.#readHp(actor);
				const value = after.value - before.value;
				const temp = after.temp - before.temp;
				if (value || temp) this.hp.push({ uuid: actor.uuid, value, temp });
			}
		};
	}

	static #readHp(actor) {
		const hp = actor.system.attributes?.hp ?? {};
		return { value: Number(hp.value) || 0, temp: Number(hp.temp) || 0 };
	}

	get isEmpty() {
		return !this.items.length && !this.effects.length && !this.hp.length && !this.messages.length;
	}

	/** Message flag payload, or null when there is nothing to undo. */
	toFlag() {
		if (this.isEmpty) return null;
		const { items, effects, flags, hp, messages } = this;
		return { items, effects, flags, hp, messages };
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Sums per-document deltas so a document changed several times is written once. */
function sumDeltas(entries, fn) {
	const totals = new Map();
	for (const entry of entries ?? []) {
		const [a, b] = fn(entry);
		const prev = totals.get(entry.uuid) ?? [0, 0];
		totals.set(entry.uuid, [prev[0] + a, prev[1] + b]);
	}
	return totals;
}

/**
 * Applies the recorded item and HP changes forwards (+1) or backwards (−1).
 * Each document is updated in its own {@link attempt}, so one failure doesn't stop the rest.
 * @param {object} data - The card's undo flag.
 * @param {1|-1} direction
 * @param {{ failures: number }} state
 */
async function applyDeltas(data, direction, state) {
	for (const [uuid, [delta]] of sumDeltas(data.items, (e) => [e.after - e.before, 0])) {
		const item = fromUuidSync(uuid);
		if (!item || !delta) continue;
		const { spent, max } = item.system.uses;
		const next = Math.clamp(spent + direction * delta, 0, max);
		await attempt(state, `update ${item.name}`, () => item.update({ 'system.uses.spent': next }));
		dev.debugLog('info', `${item.actor?.name}: ${item.name} spent ${spent} → ${next}`);
	}

	for (const [uuid, [value, temp]] of sumDeltas(data.hp, (e) => [e.value, e.temp])) {
		const actor = fromUuidSync(uuid);
		const hp = actor?.system.attributes?.hp;
		if (!hp) continue;
		const max = hp.effectiveMax ?? hp.max ?? Infinity;
		const update = {};
		if (value) update['system.attributes.hp.value'] = Math.clamp(hp.value + direction * value, 0, max);
		if (temp) update['system.attributes.hp.temp'] = Math.max((hp.temp ?? 0) + direction * temp, 0);
		await attempt(state, `update HP of ${actor.name}`, () => actor.update(update));
		dev.debugLog('info', `${actor.name}: HP ${hp.value} → ${update['system.attributes.hp.value'] ?? hp.value}`);
	}
}

async function setModuleFlag(doc, key, value) {
	if (value === null || value === undefined) await doc.unsetFlag(MODULE_ID, key);
	else await doc.setFlag(MODULE_ID, key, value);
}

/** Is this embedded effect / chat message still in its collection (not deleted by someone else)? */
function stillExists(doc) {
	if (doc.documentName === 'ChatMessage') return game.messages.has(doc.id);
	return !!doc.parent?.effects?.has(doc.id);
}

/**
 * Runs one undo/apply step, logging instead of throwing so a single failure
 * (typically a document another module already removed, e.g. a Prone condition
 * cleaned up when "Endurance broken" goes away) can't abort the rest.
 * @param {{ failures: number }} state
 * @param {string} label
 * @param {() => Promise<unknown>} fn
 * @param {Document} [doc] - If given and it no longer exists after an error, the step
 *   counts as done (someone else removed it, which is the outcome we wanted anyway).
 */
async function attempt(state, label, fn, doc = null) {
	try {
		await fn();
	} catch (err) {
		if (doc && !stillExists(doc)) {
			dev.debugLog('info', `${label}: already removed elsewhere`);
			return;
		}
		state.failures++;
		console.warn(`${MODULE_ID} | ${label} skipped:`, err?.message ?? err);
	}
}

// ── Undo / Apply ─────────────────────────────────────────────────────────────

/**
 * Reverts the changes recorded on an HBM chat message. GM only.
 *
 * Order: delete created chat cards, delete created effects (broken effects are
 * flagged first so their onDelete macro doesn't reset Endurance to 0), reverse
 * item/HP deltas, restore flags. What was deleted is stashed for {@link applyMessage}.
 * @param {ChatMessage} message
 */
export async function undoMessage(message) {
	if (!game.user.isGM) return;
	const data = message.getFlag(MODULE_ID, 'undo');
	if (!data || message.getFlag(MODULE_ID, 'undone')) return;

	dev.debugGroupStart(`Undo — message ${message.id}`);
	const state = { failures: 0 };
	const stash = { messages: [], effects: [], flags: [] };

	// Snapshot everything first, so the stash is complete even if a later step fails.
	const messages = (data.messages ?? []).map((uuid) => fromUuidSync(uuid)).filter((m) => m && m.id !== message.id);
	const effects = (data.effects ?? []).map((uuid) => fromUuidSync(uuid)).filter(Boolean);
	stash.messages = messages.map((m) => m.toObject());
	stash.effects = effects.map((e) => ({ parentUuid: e.parent.uuid, data: e.toObject() }));

	try {
		for (const msg of messages) {
			if (stillExists(msg)) await attempt(state, `delete message ${msg.id}`, () => msg.delete(), msg);
		}

		// Newest first: effects captured from the break roll (e.g. a Prone condition)
		// go before "Endurance broken", which other modules may tie them to.
		for (const effect of [...effects].reverse()) {
			if (!stillExists(effect)) continue;
			await attempt(
				state,
				`flag effect ${effect.name}`,
				() => effect.update({ [`flags.${MODULE_ID}.${UNDO_EFFECT_FLAG}`]: true }),
				effect,
			);
			if (!stillExists(effect)) continue;
			await attempt(state, `delete effect ${effect.name}`, () => effect.delete(), effect);
			dev.debugLog('info', `Removed effect ${effect.name} from ${effect.parent?.name}`);
		}

		await applyDeltas(data, -1, state);

		for (const { uuid, key, previous } of [...(data.flags ?? [])].reverse()) {
			const doc = fromUuidSync(uuid);
			if (!doc) continue;
			stash.flags.push({ uuid, key, applied: doc.getFlag(MODULE_ID, key) ?? null });
			await attempt(state, `restore flag ${key}`, () => setModuleFlag(doc, key, previous));
		}
	} finally {
		await message.update({ [`flags.${MODULE_ID}.undone`]: true, [`flags.${MODULE_ID}.stash`]: stash });
		dev.debugGroupEnd();
	}
	notifyResult('XHM.Undo.Done', state);
}

/** Success toast, or a warning when some steps were skipped. */
function notifyResult(doneKey, { failures }) {
	if (!failures) ui.notifications.info(game.i18n.localize(doneKey));
	else ui.notifications.warn(game.i18n.format('XHM.Undo.Partial', { count: failures }));
}

/**
 * Re-applies changes previously reverted with {@link undoMessage}: recreates the
 * stashed effects and chat cards (same IDs, so a later Undo still finds them),
 * re-applies item/HP deltas and the flag values from before the undo. GM only.
 * @param {ChatMessage} message
 */
export async function applyMessage(message) {
	if (!game.user.isGM) return;
	const data = message.getFlag(MODULE_ID, 'undo');
	const stash = message.getFlag(MODULE_ID, 'stash') ?? {};
	if (!data || !message.getFlag(MODULE_ID, 'undone')) return;

	dev.debugGroupStart(`Apply — message ${message.id}`);
	const state = { failures: 0 };

	try {
		// Oldest first: "Endurance broken" before anything tied to it. Re-check right before
		// each create, since another module may already have re-added e.g. Prone.
		for (const { parentUuid, data: effectData } of stash.effects ?? []) {
			const parent = fromUuidSync(parentUuid);
			if (!parent || parent.effects.has(effectData._id)) continue;
			delete effectData.flags?.[MODULE_ID]?.[UNDO_EFFECT_FLAG];
			await attempt(state, `restore effect ${effectData.name}`, async () => {
				if (parent.effects.has(effectData._id)) return;
				await parent.createEmbeddedDocuments('ActiveEffect', [effectData], { keepId: true });
				dev.debugLog('info', `Restored effect ${effectData.name} on ${parent.name}`);
			});
		}

		await applyDeltas(data, 1, state);

		for (const { uuid, key, applied } of stash.flags ?? []) {
			const doc = fromUuidSync(uuid);
			if (doc) await attempt(state, `reapply flag ${key}`, () => setModuleFlag(doc, key, applied));
		}

		for (const messageData of stash.messages ?? []) {
			if (game.messages.has(messageData._id)) continue;
			// Keeps its original timestamp; the flag tells every client to slot it back in place.
			foundry.utils.setProperty(messageData, `flags.${MODULE_ID}.${RESTORED_FLAG}`, true);
			await attempt(state, `restore message ${messageData._id}`, () =>
				ChatMessage.implementation.create(messageData, { keepId: true }),
			);
		}
	} finally {
		await message.update({ [`flags.${MODULE_ID}.undone`]: false, [`flags.${MODULE_ID}.-=stash`]: null });
		dev.debugGroupEnd();
	}
	notifyResult('XHM.Undo.Applied', state);
}

// ── Restored message placement ───────────────────────────────────────────────

/**
 * Moves `message` before `nextId` in the `game.messages` collection order, which
 * the chat log uses for things like loading older batches. Uses Map's own methods
 * so DocumentCollection bookkeeping isn't triggered for an order-only change.
 */
function reorderCollection(message, nextId) {
	const entries = [...game.messages.entries()].filter(([id]) => id !== message.id);
	const index = entries.findIndex(([id]) => id === nextId);
	if (index < 0) return;
	entries.splice(index, 0, [message.id, message]);
	Map.prototype.clear.call(game.messages);
	for (const [id, doc] of entries) Map.prototype.set.call(game.messages, id, doc);
}

/** Moves the rendered message element before `nextId` in every chat log (sidebar + popout). */
function moveRenderedMessage(message, nextId, triesLeft = 60) {
	const logs = [ui.chat?.element, ui.chat?.popout?.element].filter(Boolean);
	const pending = logs.some((log) => !log.querySelector(`.message[data-message-id="${message.id}"]`));
	for (const log of logs) {
		const el = log.querySelector(`.message[data-message-id="${message.id}"]`);
		const next = log.querySelector(`.message[data-message-id="${nextId}"]`);
		if (el && next && el.nextElementSibling !== next) next.before(el);
	}
	// The log renders new messages through an async queue; retry until it has.
	if (pending && triesLeft > 0) requestAnimationFrame(() => moveRenderedMessage(message, nextId, triesLeft - 1));
}

/**
 * Chat logs append every newly created message at the bottom. Messages recreated
 * by Apply keep their original timestamp, so on every client put them back in
 * timestamp order (after a reload Foundry already loads chat sorted by timestamp).
 */
export function registerRestoredMessageOrdering() {
	Hooks.on('createChatMessage', (message) => {
		if (!message.getFlag(MODULE_ID, RESTORED_FLAG)) return;
		const next = game.messages.contents.find((m) => m.id !== message.id && m.timestamp > message.timestamp);
		if (!next) return;
		reorderCollection(message, next.id);
		moveRenderedMessage(message, next.id);
	});
}

/**
 * Adds the GM-only Undo / Apply control to an HBM card.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function renderUndoControl(message, html) {
	if (!game.user.isGM || !message.getFlag(MODULE_ID, 'undo')) return;
	const card = html.querySelector('.hbm-card');
	if (!card || card.querySelector('.hbm-undo')) return;

	const undone = !!message.getFlag(MODULE_ID, 'undone');
	const footer = document.createElement('div');
	footer.className = 'hbm-undo';

	if (undone) {
		const note = document.createElement('span');
		note.className = 'hbm-undo__done';
		note.innerHTML = `<i class="fa-solid fa-rotate-left"></i> ${game.i18n.localize('XHM.Undo.Reverted')}`;
		footer.append(note);
	}

	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'hbm-undo__button';
	button.dataset.tooltip = game.i18n.localize(undone ? 'XHM.Undo.ApplyTooltip' : 'XHM.Undo.Tooltip');
	button.innerHTML = undone
		? `<i class="fa-solid fa-rotate-right"></i> ${game.i18n.localize('XHM.Undo.Apply')}`
		: `<i class="fa-solid fa-rotate-left"></i> ${game.i18n.localize('XHM.Undo.Button')}`;
	button.addEventListener('click', async (event) => {
		event.preventDefault();
		button.disabled = true;
		try {
			await (undone ? applyMessage(message) : undoMessage(message));
		} catch (err) {
			console.error(`${MODULE_ID} | ${undone ? 'Apply' : 'Undo'} failed`, err);
			ui.notifications.error(game.i18n.localize('XHM.Undo.Failed'));
			button.disabled = false;
		}
	});
	footer.append(button);

	card.append(footer);
}
