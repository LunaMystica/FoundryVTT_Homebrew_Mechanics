class Dev {
	// ── Internals ──────────────────────────────────────────────────────────────

	#isDebugEnabled() {
		return game.settings.get('xeno-homebrew-mechanics', 'debug-toggle');
	}

	static #prefix = {
		info: '[info]',
		success: '[ok]  ',
		warning: '[warn]',
		error: '[err] ',
		process: '[proc]',
		target: '[hit] ',
		math: '[math]',
		update: '[upd] ',
	};

	// ── Public API ─────────────────────────────────────────────────────────────

	/**
	 * Opens a named console group. All subsequent logs are nested until debugGroupEnd().
	 * @param {string} title
	 */
	debugGroupStart(title) {
		if (!this.#isDebugEnabled()) return;
		console.group(`HBM | ${title}`);
	}

	/**
	 * Closes the most recently opened console group.
	 */
	debugGroupEnd() {
		if (!this.#isDebugEnabled()) return;
		console.groupEnd();
	}

	/**
	 * Logs a categorised message, with an optional data payload on a second line.
	 * @param {'info'|'success'|'warning'|'error'|'process'|'target'|'math'|'update'} category
	 * @param {string} message
	 * @param {*} [data]
	 */
	debugLog(category, message, data) {
		if (!this.#isDebugEnabled()) return;

		const prefix = Dev.#prefix[category] ?? '[log] ';
		console.log(`${prefix} ${message}`);

		if (data !== undefined) console.log('      ', data);
	}

	/**
	 * Logs a labelled object inside a collapsed console group (click to expand).
	 * @param {string} label
	 * @param {*} data
	 */
	debugDump(label, data) {
		if (!this.#isDebugEnabled()) return;
		console.groupCollapsed(`[dump]  ${label}`);
		console.log(data);
		console.groupEnd();
	}

	/**
	 * Logs the full MidiQOL workflow object as a collapsed group.
	 * @param {Workflow} workflow
	 */
	debugWorkflow(workflow) {
		if (!this.#isDebugEnabled()) return;
		this.debugDump('workflow', workflow);
	}

	/**
	 * Logs the damage list as a collapsed group, if present and non-empty.
	 * @param {Object[]} damageList
	 */
	debugDamageList(damageList) {
		if (!this.#isDebugEnabled() || !damageList?.length) return;
		this.debugDump(`damageList (${damageList.length})`, damageList);
	}
}

export const dev = new Dev();
