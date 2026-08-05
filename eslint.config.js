// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const prettier = require('eslint-config-prettier');

module.exports = tseslint.config(
  {
    // `.angular/` is the CLI build cache. It only exists after a first build, so
    // omitting it lints clean on a fresh clone and then fails in CI — include it.
    ignores: ['.angular/**', 'dist/**', 'target/**', 'coverage/**', 'android/**', 'ios/**', 'node_modules/**', '*.config.js'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
      prettier,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'hpd', style: 'camelCase' }],
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'hpd', style: 'kebab-case' }],
      // Ionic convention: routed screens are `*Page` in `*.page.ts`. The Angular
      // style guide only knows about `*Component`, so both suffixes are allowed.
      '@angular-eslint/component-class-suffix': ['error', { suffixes: ['Component', 'Page'] }],
      // Capacitor plugins must only ever be reached through a wrapper in
      // src/app/core/native/ — that is what keeps components and specs testable
      // and makes a plugin swap a one-file change. See mobile/CLAUDE.md.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@capacitor/*', '@aparajita/capacitor-*'],
              message: 'Import the wrapper from src/app/core/native/ instead of the Capacitor plugin directly (see mobile/CLAUDE.md).',
            },
          ],
        },
      ],
    },
  },
  {
    // The wrappers themselves, the diagnostics probe and the Capacitor config are
    // the only places allowed to touch the plugins.
    files: ['src/app/core/native/**/*.ts', 'src/app/shell/diagnostics.page.ts', 'src/environments/*.ts', 'capacitor.config.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.spec.ts'],
    rules: { 'no-restricted-imports': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {},
  },
);
