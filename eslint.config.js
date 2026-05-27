import js from '@eslint/js';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

export default defineConfig([
	{
		files: ['**/*.{js,mjs,cjs}'],
		plugins: { js },
		extends: ['js/recommended'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: {
				...globals.browser,

				// Foundry core globals
				game: 'readonly',
				ui: 'readonly',
				canvas: 'readonly',
				CONFIG: 'readonly',
				CONST: 'readonly',
				Hooks: 'readonly',
				foundry: 'readonly',

				// Common Foundry helpers you use in macros
				fromUuid: 'readonly',
				fromUuidSync: 'readonly',

				// Sequencer module globals
				Sequencer: 'readonly',
				Sequence: 'readonly',

				// Chris's Premades global
				chrisPremades: 'readonly',

				// ChrisPremades macro context variables (commonly injected)
				actor: 'readonly',
				token: 'readonly',
				item: 'readonly',
				workflow: 'readonly',
				args: 'readonly',
			},
		},
		rules: {
			// keep this: it’s what helps shrink your destructuring over time
			'no-unused-vars': ['warn', { vars: 'all', args: 'after-used' }],
		},
	},
]);
