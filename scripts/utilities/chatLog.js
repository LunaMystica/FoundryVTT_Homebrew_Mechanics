class ChatLog {
	// ── Helpers ────────────────────────────────────────────────────────────────

	/**
	 * Cleans up redundant HTML artifacts that arise from how messages are assembled.
	 * @param {string} content
	 * @returns {string}
	 */
	static cleanContent(content) {
		return content.replace(/<\/h3><br>/g, '</h3>').replace(/<hr><br>/g, '<hr>');
	}

	// ── Public API ─────────────────────────────────────────────────────────────

	/**
	 * Sends a chat message if chat messages are enabled in settings.
	 * Broadcasts publicly by default; pass publicChat: false to whisper to GM.
	 *
	 * @param {string} content - HTML-formatted message content.
	 * @param {object} [options]
	 * @param {boolean} [options.publicChat=true] - Broadcast to all players. Set false to whisper GM.
	 * @param {string} [options.speaker='HBM'] - Speaker alias shown in chat.
	 * @returns {Promise<void>}
	 */
	async send(content, { publicChat = true, speaker = 'HBM' } = {}) {
		if (!game.settings.get('xeno-homebrew-mechanics', 'chat-message-toggle')) return;

		const chatData = {
			content: ChatLog.cleanContent(content),
			speaker: { alias: speaker },
			...(!publicChat && { whisper: ChatMessage.getWhisperRecipients('GM') }),
		};

		await ChatMessage.create(chatData);
	}
}

export const chatLog = new ChatLog();
