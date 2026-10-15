/**
 * Reloads every connected client (GM only): emits core's `reload` socket event,
 * which the server relays to all other clients, then reloads this one.
 * Same mechanism core uses after changing a world setting that requires a reload.
 *
 * @param {object} [options]
 * @param {boolean} [options.confirm=true] - Ask before reloading.
 */
export async function reloadEveryone({ confirm = true } = {}) {
	if (!game.user.isGM) {
		ui.notifications.warn(game.i18n.localize('XHM.Reload.GMOnly'));
		return;
	}
	if (confirm) {
		const ok = await foundry.applications.api.DialogV2.confirm({
			window: { title: 'XHM.Reload.Title', icon: 'fa-solid fa-arrows-rotate' },
			content: `<p>${game.i18n.localize('XHM.Reload.Body')}</p>`,
			modal: true,
		});
		if (!ok) return;
	}
	game.socket.emit('reload');
	foundry.utils.debouncedReload();
}

/**
 * Settings-menu "app" that reloads everyone instead of opening a window.
 * `registerMenu` requires an ApplicationV2 (or FormApplication) subclass; the
 * settings window then calls `new type()` and `render()`, which we repurpose.
 */
export class ReloadEveryoneMenu extends foundry.applications.api.ApplicationV2 {
	async render() {
		await reloadEveryone();
		return this;
	}
}
