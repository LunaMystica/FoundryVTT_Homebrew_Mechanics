module.exports = {
	plugins: ['unused-imports'],
	rules: {
		// turn off the default rule
		'no-unused-vars': 'off',

		// remove unused imports
		'unused-imports/no-unused-imports': 'error',
		'max-len': ['error', { code: 160 }],

		parserOptions: {
			sourceType: 'module',
		},

		// optionally remove unused variables too
		'unused-imports/no-unused-vars': [
			'error',
			{
				vars: 'all',
				varsIgnorePattern: '^_',
				args: 'after-used',
				argsIgnorePattern: '^_',
			},
		],
	},
};
