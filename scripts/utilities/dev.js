class Dev {
	// ── Internals ──────────────────────────────────────────────────────────────

	#isDebugEnabled() {
		return game.settings.get('xeno-homebrew-mechanics', 'debug-toggle');
	}

	static #icons = {
		info: '🔍',
		success: '✅',
		warning: '⚠️',
		error: '❌',
		process: '⚙️',
		target: '🎯',
		math: '🧮',
		update: '📝',
	};

	// ── Public API ─────────────────────────────────────────────────────────────

	/**
	 * Opens a named console group. All subsequent logs are nested until debugGroupEnd().
	 * @param {string} title
	 */
	debugGroupStart(title) {
		if (!this.#isDebugEnabled()) return;
		console.group(`🏠 Homebrew Mechanics: ${title}`);
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

		const icon = Dev.#icons[category] ?? '📋';
		console.log(`${icon} ${message}`);

		if (data !== undefined) console.log('   Data:', data);
	}

	/**
	 * Logs a full MidiQOL workflow object.
	 * @param {Workflow} workflow
	 */
	debugWorkflow(workflow) {
		if (!this.#isDebugEnabled()) return;
		this.debugLog('process', 'Workflow', workflow);
	}

	/**
	 * Logs the damage list if present and non-empty.
	 * @param {Object[]} damageList
	 */
	debugDamageList(damageList) {
		if (!this.#isDebugEnabled() || !damageList?.length) return;
		this.debugLog('target', `Damage list — ${damageList.length} entr${damageList.length !== 1 ? 'ies' : 'y'}`, damageList);
	}
}

export const dev = new Dev();
