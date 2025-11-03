/**
 * Send a message to chat if chat messages are enabled
 * @param {string} messageContent - The message content (HTML formatted)
 * @param {Object} [options={}] - Configuration options
 * @param {boolean} [options.publicChat=false] - Send to all players instead of GM whisper
 * @param {string} [options.speaker='Homebrew Mechanics'] - Custom speaker alias
 * @returns {Promise<void>}
 */
async function chatLog(messageContent, options = {}) {
	const {
		publicChat = false,
		speaker = 'Homebrew Mechanics'
	} = options;

	// Only send if chat messages are enabled
	const chatEnabled = game.settings.get('xeno-homebrew-mechanics', 'chat-message-toggle');
	if (!chatEnabled) return;

	// Clean up HTML formatting
	const cleanedContent = messageContent
		.replace(/<\/h3><br>/g, '</h3>')
		.replace(/<hr><br>/g, '<hr>');

	const chatData = {
		content: cleanedContent,
		speaker: { alias: speaker }
	};

	// Set whisper recipients unless public chat is requested
	if (!publicChat) {
		chatData.whisper = ChatMessage.getWhisperRecipients('GM');
	}

	await ChatMessage.create(chatData);
	return;
}

export { chatLog };