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
	 * Whispers to GM by default; pass publicChat to broadcast to all players.
	 *
	 * @param {string} content - HTML-formatted message content.
	 * @param {object} [options]
	 * @param {boolean} [options.publicChat=false] - Broadcast to all players instead of GM whisper.
	 * @param {string} [options.speaker='Homebrew Mechanics'] - Speaker alias shown in chat.
	 * @returns {Promise<void>}
	 */
	async send(content, { publicChat = false, speaker = 'Homebrew Mechanics' } = {}) {
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
