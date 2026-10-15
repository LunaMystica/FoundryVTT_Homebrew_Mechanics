import { ENDURANCE_DEFAULTS, SOUL_DEFAULTS, getEnduranceValues, getSoulValues, sanitizeValues } from './values.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Field order + i18n keys for the form (keys match the defaults objects). */
const ENDURANCE_FIELDS = [
	'weapon',
	'cantrip',
	'spell',
	'soulstrike',
	'soulburst',
	'weaknessBreak',
	'feat',
	'other',
	'critBonus',
];
const SOUL_FIELDS = ['attackPerTarget', 'aoePerTarget', 'damageTakenRatio'];

/** Settings menu for the Endurance reduction table and Soul gain amounts. */
export class ValuesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: 'xhm-values-config',
		tag: 'form',
		form: {
			handler: ValuesConfig._onSubmit,
			closeOnSubmit: true,
		},
		actions: {
			resetDefaults: ValuesConfig._onResetDefaults,
		},
		position: { width: 480, height: 'auto' },
		window: { title: 'XHM.ValuesConfig.Title' },
	};

	static PARTS = {
		form: { template: 'modules/xeno-homebrew-mechanics/scripts/values/values-config.hbs' },
	};

	async _prepareContext() {
		const field = (group, defaults, values) => (key) => ({
			name: `${group}.${key}`,
			label: `XHM.ValuesConfig.${group}.${key}`,
			value: values[key],
			default: defaults[key],
			step: key === 'damageTakenRatio' ? 'any' : 1,
		});
		return {
			endurance: ENDURANCE_FIELDS.map(field('endurance', ENDURANCE_DEFAULTS, getEnduranceValues())),
			soul: SOUL_FIELDS.map(field('soul', SOUL_DEFAULTS, getSoulValues())),
		};
	}

	/** Fills the inputs with the defaults (not saved until Save is pressed). */
	static _onResetDefaults() {
		const fill = (group, defaults) => {
			for (const [key, value] of Object.entries(defaults)) {
				const input = this.element.querySelector(`[name="${group}.${key}"]`);
				if (input) input.value = value;
			}
		};
		fill('endurance', ENDURANCE_DEFAULTS);
		fill('soul', SOUL_DEFAULTS);
	}

	static async _onSubmit(event, form, formData) {
		const data = foundry.utils.expandObject(formData.object);
		await game.settings.set(
			'xeno-homebrew-mechanics',
			'endurance-values',
			sanitizeValues(ENDURANCE_DEFAULTS, data.endurance),
		);
		await game.settings.set('xeno-homebrew-mechanics', 'soul-values', sanitizeValues(SOUL_DEFAULTS, data.soul));
	}
}
