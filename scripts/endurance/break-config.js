const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EnduranceBreakConfig extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: 'endurance-break-config',
		tag: 'form',
		form: {
			handler: EnduranceBreakConfig._onSubmit,
			closeOnSubmit: true,
		},
		position: { width: 560, height: 520 },
		window: { title: 'XHM.BreakConfig.Title' },
	};

	static PARTS = {
		form: { template: 'modules/xeno-homebrew-mechanics/scripts/endurance/break-config.hbs' },
	};

	async _prepareContext() {
		const stored = game.settings.get('xeno-homebrew-mechanics', 'endurance-damage-items');
		const damageTypes = Object.entries(CONFIG.DND5E.damageTypes).map(([key, cfg]) => ({
			key,
			label: cfg?.label ?? key,
			uuid: stored[key] ?? '',
		}));
		return { damageTypes };
	}

	static async _onSubmit(event, form, formData) {
		const data = {};
		for (const [key, value] of Object.entries(formData.object)) {
			if (value) data[key] = value;
		}
		await game.settings.set('xeno-homebrew-mechanics', 'endurance-damage-items', data);
	}
}
