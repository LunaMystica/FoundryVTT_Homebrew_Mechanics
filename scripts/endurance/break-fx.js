import { dev } from '../core/dev.js';

const MODULE_ID = 'xeno-homebrew-mechanics';

/** Text style for the floating "BREAK!" label (PIXI text style + Foundry scrolling-text options). */
const BREAK_TEXT_STYLE = {
	fontSize: 44,
	fontWeight: 'bold',
	fill: '#ff6b3d',
	stroke: '#1a0500',
	strokeThickness: 6,
	dropShadow: true,
	dropShadowColor: '#000000',
	dropShadowBlur: 6,
	dropShadowDistance: 0,
};

/**
 * Plays the Endurance-break feedback on a token: floating "BREAK!" text, an
 * optional animation file, an optional sound and a short screen shake.
 *
 * With Sequencer active everything is broadcast to every client viewing the
 * scene. Without it, the text shows only on this client and the sound is
 * broadcast through Foundry's AudioHelper.
 *
 * Fire-and-forget: errors are logged, never thrown, so FX can't break the
 * automation.
 *
 * @param {Token|null|undefined} token
 */
export function playBreakFx(token) {
	if (!token || !game.settings.get(MODULE_ID, 'break-fx-toggle')) return;
	_play(token).catch((err) => console.error(`${MODULE_ID} | Break FX failed`, err));
}

async function _play(token) {
	const text = game.i18n.localize('XHM.BreakFx.Text');
	const sound = (game.settings.get(MODULE_ID, 'break-fx-sound') ?? '').trim();
	const animation = (game.settings.get(MODULE_ID, 'break-fx-file') ?? '').trim();
	const shake = game.settings.get(MODULE_ID, 'break-fx-shake');

	if (game.modules.get('sequencer')?.active && globalThis.Sequence) {
		const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
		if (animation) seq.effect().file(animation).atLocation(token).scaleToObject(1.75).aboveLighting();
		if (sound) seq.sound().file(sound).volume(0.8);
		seq.scrollingText(token, text, BREAK_TEXT_STYLE).anchor('TOP').direction('TOP').duration(2200).jitter(0.1);
		if (shake) seq.canvasPan().shake({ duration: 300, strength: 6, rotation: false });
		await seq.play();
		dev.debugLog('success', `Break FX (Sequencer) on ${token.name}`);
		return;
	}

	canvas.interface?.createScrollingText(token.center, text, {
		...BREAK_TEXT_STYLE,
		anchor: CONST.TEXT_ANCHOR_POINTS.TOP,
		direction: CONST.TEXT_ANCHOR_POINTS.TOP,
		duration: 2200,
		jitter: 0.1,
	});
	if (sound) foundry.audio.AudioHelper.play({ src: sound, volume: 0.8, autoplay: true, loop: false }, true);
	dev.debugLog('success', `Break FX (core) on ${token.name}`);
}
