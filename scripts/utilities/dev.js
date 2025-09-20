async function log(messageContent) {
	const debug = game.settings.get('xeno-homebrew-mechanics', 'debug-toggle');
	const chat_messages = game.settings.get('xeno-homebrew-mechanics', 'chat-message-toggle');
	if (chat_messages) {
		messageContent = messageContent.replace(/<\/h3><br>/g, '</h3>');
		messageContent = messageContent.replace(/<hr><br>/g, '<hr>');

		await ChatMessage.create({
			content: messageContent,
			speaker: {
				alias: 'Homebrew Mechanics',
			},
			whisper: ChatMessage.getWhisperRecipients('GM'),
		});
	}
	if (debug && !chat_messages) {
		messageContent = messageContent.replace(/<br>/g, '\n');
		messageContent = messageContent.replace(/<hr>/g, '');

		console.log(messageContent);
	}
	return;
}

/**
 * Start a debug group with specified title and styling
 * @param {string} title - The group title
 * @param {Object} data - Optional data to display
 */
function debugGroupStart(title, data = null) {
	const debug = game.settings.get('xeno-homebrew-mechanics', 'debug-toggle');
	if (!debug) return;
	
	console.group(`🏠 Homebrew Mechanics: ${title}`);
	if (data) {
		console.log('📊 Initial Data:', data);
	}
}

/**
 * End the current debug group
 */
function debugGroupEnd() {
	const debug = game.settings.get('xeno-homebrew-mechanics', 'debug-toggle');
	if (!debug) return;
	
	console.groupEnd();
}

/**
 * Log debug information with categorized styling
 * @param {string} category - Category type (info, success, warning, error, process)
 * @param {string} message - The message to log
 * @param {*} data - Optional data to display
 */
function debugLog(category, message, data = null) {
	const debug = game.settings.get('xeno-homebrew-mechanics', 'debug-toggle');
	if (!debug) return;
	
	const categoryStyles = {
		info: '🔍',
		success: '✅',
		warning: '⚠️',
		error: '❌',
		process: '⚙️',
		target: '🎯',
		math: '🧮',
		update: '📝'
	};
	
	const icon = categoryStyles[category] || '📋';
	console.log(`${icon} ${message}`);
	
	if (data !== null && data !== undefined) {
		console.log('   Data:', data);
	}
}

/**
 * Log workflow information in a structured way
 * @param {Object} workflow - The MidiQOL workflow object
 */
function debugWorkflow(workflow) {
	const debug = game.settings.get('xeno-homebrew-mechanics', 'debug-toggle');
	if (!debug) return;
	
	const workflowData = {
		item: {
			name: workflow.item?.name,
			type: workflow.item?.type,
			section: workflow.item?.flags?.['tidy5e-sheet']?.section
		},
		actor: workflow.actor?.name,
		hitTargets: workflow.hitTargets?.size || 0,
		damageRolls: workflow.damageRolls?.map(roll => ({
			total: roll.total,
			type: roll.options?.type
		})) || [],
		damageList: workflow.damageList?.length || 0
	};
	
	debugLog('process', 'Workflow Details', workflowData);
}

/**
 * Log damage list information
 * @param {Array} damageList - Array of damage targets
 */
function debugDamageList(damageList) {
	const debug = game.settings.get('xeno-homebrew-mechanics', 'debug-toggle');
	if (!debug || !damageList || damageList.length === 0) return;
	
	const damageData = damageList.map(target => ({
		actorName: target.actor?.name || 'Unknown',
		tempDamage: target.tempDamage || 0,
		hpDamage: target.hpDamage || 0,
		totalDamage: (target.tempDamage || 0) + (target.hpDamage || 0)
	}));
	
	debugLog('target', 'Damage List Processing', damageData);
}

export const dev = { 
	log, 
	debugGroupStart, 
	debugGroupEnd, 
	debugLog, 
	debugWorkflow, 
	debugDamageList 
};
