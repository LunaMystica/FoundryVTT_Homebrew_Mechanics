import eslintPluginPrettier from 'eslint-plugin-prettier';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginUnusedImports from 'eslint-plugin-unused-imports';

export default [
	{
		files: ['**/*.js'],
		plugins: {
			prettier: eslintPluginPrettier,
			'unused-imports': eslintPluginUnusedImports,
		},

		rules: {
			...eslintConfigPrettier.rules,
			'prettier/prettier': ['warn', { endOfLine: 'auto' }],

			// Treat all code as script
			parserOptions: {
				sourceType: 'script',
			},

			// Increase max line length
			'max-len': ['warn', { code: 160 }],

			'editor.formatOnSave': true,

			// Turn off default rule
			'no-unused-vars': 'off',

			// Use unused-imports instead
			'unused-imports/no-unused-imports': 'warn',
			'unused-imports/no-unused-vars': [
				'warn',
				{
					vars: 'all',
					varsIgnorePattern: '^_',
					args: 'after-used',
					argsIgnorePattern: '^_',
				},
			],
		},
	},
];
