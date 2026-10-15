const MODULE_ID = 'xeno-homebrew-mechanics';
const { ApplicationV2 } = foundry.applications.api;

/** File-picker categories, mirroring core SettingsConfig. */
const FILE_CATEGORIES = {
	audio: ['AUDIO'],
	image: ['IMAGE'],
	imagevideo: ['IMAGE', 'VIDEO'],
	video: ['VIDEO'],
};

/**
 * A settings window showing a fixed list of this module's settings, so related
 * options live in their own submenu instead of one long list. Subclasses set
 * `static KEYS`; settings listed here should be registered with `config: false`.
 *
 * Fields are built the same way core SettingsConfig builds them.
 */
export class SettingsSubmenu extends ApplicationV2 {
	/** @type {string[]} Setting keys shown by this menu, in order. */
	static KEYS = [];

	/** @type {string|null} i18n key for a hint shown above the fields. */
	static HINT = null;

	static DEFAULT_OPTIONS = {
		tag: 'form',
		classes: ['xhm-submenu'],
		form: { handler: SettingsSubmenu.#onSubmit, closeOnSubmit: true },
		position: { width: 520, height: 'auto' },
		window: { contentClasses: ['standard-form'] },
	};

	/**
	 * Builds a form field for one registered setting.
	 * @param {string} key
	 * @returns {HTMLElement|null}
	 */
	#formGroup(key) {
		const setting = game.settings.settings.get(`${MODULE_ID}.${key}`);
		if (!setting) return null;
		const fields = foundry.data.fields;
		const value = game.settings.get(MODULE_ID, key);

		const choices = setting.choices
			? Object.fromEntries(Object.entries(setting.choices).map(([k, label]) => [k, game.i18n.localize(label)]))
			: undefined;

		let field;
		if (setting.type === Boolean) field = new fields.BooleanField({ initial: setting.default ?? false });
		else if (setting.type === Number) field = new fields.NumberField({ required: true, choices });
		else if (setting.filePicker) {
			const categories = FILE_CATEGORIES[setting.filePicker] ?? ['IMAGE', 'VIDEO', 'AUDIO'];
			field = new fields.FilePathField({ required: true, blank: true, categories });
		} else field = new fields.StringField({ required: true, blank: !choices, choices });

		return field.toFormGroup(
			{ label: game.i18n.localize(setting.name ?? ''), hint: game.i18n.localize(setting.hint ?? '') },
			{ name: `${MODULE_ID}.${key}`, value },
		);
	}

	async _renderHTML() {
		const container = document.createElement('div');
		const hint = this.constructor.HINT;
		if (hint) {
			const p = document.createElement('p');
			p.className = 'hint';
			p.textContent = game.i18n.localize(hint);
			container.append(p);
		}
		for (const key of this.constructor.KEYS) {
			const group = this.#formGroup(key);
			if (group) container.append(group);
		}
		const footer = document.createElement('footer');
		footer.className = 'form-footer';
		footer.innerHTML = `<button type="submit"><i class="fa-solid fa-save"></i> ${game.i18n.localize('XHM.Submenu.Save')}</button>`;
		container.append(footer);
		return container;
	}

	_replaceHTML(result, content) {
		content.replaceChildren(...result.children);
	}

	static async #onSubmit(_event, _form, formData) {
		for (const [name, value] of Object.entries(formData.object)) {
			if (!name.startsWith(`${MODULE_ID}.`)) continue;
			const key = name.slice(MODULE_ID.length + 1);
			const current = game.settings.get(MODULE_ID, key);
			const next = typeof current === 'boolean' ? !!value : (value ?? '');
			if (next !== current) await game.settings.set(MODULE_ID, key, next);
		}
	}
}

/**
 * Creates a SettingsSubmenu subclass for `registerMenu`.
 * @param {{ id: string, title: string, keys: string[], hint?: string }} config
 * @returns {typeof SettingsSubmenu}
 */
export function createSettingsSubmenu({ id, title, keys, hint = null }) {
	return class extends SettingsSubmenu {
		static KEYS = keys;
		static HINT = hint;
		static DEFAULT_OPTIONS = { id, window: { title } };
	};
}
