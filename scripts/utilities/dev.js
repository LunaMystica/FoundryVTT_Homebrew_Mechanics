async function log(messageContent) {
	const debug = game.settings.get('xeno-homebrew-mechanics', 'debug-toggle');
	const chatDebug = game.settings.get('xeno-homebrew-mechanics', 'debug-chat');

	if (!debug) return;

	if (chatDebug) {
		messageContent = messageContent.replace(/<\/h3><br>/g, '</h3>');
		messageContent = messageContent.replace(/<hr><br>/g, '<hr>');

		await ChatMessage.create({
			content: messageContent,
			speaker: ChatMessage.getSpeaker(),
			whisper: ChatMessage.getWhisperRecipients('GM'),
		});
	} else {
		messageContent = messageContent.replace(/<br>/g, '\n');
		messageContent = messageContent.replace(/<hr>/g, '');

		console.log(messageContent);
	}
	return;
}

export const dev = { log };
