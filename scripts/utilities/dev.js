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
		update: '📝',
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

	debugLog('process', 'Workflow Details', workflow);
}

/**
 * Log damage list information
 * @param {Array} damageList - Array of damage targets
 */
function debugDamageList(damageList) {
	const debug = game.settings.get('xeno-homebrew-mechanics', 'debug-toggle');
	if (!debug || !damageList || damageList.length === 0) return;

	debugLog('target', 'Damage List Processing', damageList);
}

export const dev = {
	debugGroupStart,
	debugGroupEnd,
	debugLog,
	debugWorkflow,
	debugDamageList,
};
