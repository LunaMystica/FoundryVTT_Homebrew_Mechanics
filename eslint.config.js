import js from '@eslint/js';
import globals from 'globals';
import unusedImports from 'eslint-plugin-unused-imports';
import { defineConfig } from 'eslint/config';

export default defineConfig([
	// Installed deps and the git-ignored standalone debug macros
	// (run in Foundry's injected-global context).
	{
		ignores: ['node_modules/**', 'scripts/debug/**'],
	},
	{
		files: ['**/*.{js,mjs,cjs}'],
		plugins: { js, 'unused-imports': unusedImports },
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
				ChatMessage: 'readonly',
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
			// Strip unused imports outright; warn (don't fail) on unused vars so
			// destructuring can be shrunk over time. `_`-prefixed names are ignored.
			'no-unused-vars': 'off',
			'unused-imports/no-unused-imports': 'error',
			'unused-imports/no-unused-vars': [
				'warn',
				{ vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
			],

			// Loose backstop above Prettier's 120 printWidth; ignores lines Prettier can't break.
			'max-len': [
				'error',
				{
					code: 160,
					ignoreComments: true,
					ignoreStrings: true,
					ignoreTemplateLiterals: true,
					ignoreRegExpLiterals: true,
					ignoreUrls: true,
				},
			],
		},
	},
]);
