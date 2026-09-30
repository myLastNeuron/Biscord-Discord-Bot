// ESLint flat config (ESLint 9+). The bot is CommonJS, runs on Node, and talks
// to Discord.js — so we lint with node globals and keep the rules pragmatic:
// real mistakes are errors, style-adjacent noise is a warning.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    // Runtime/artifacts — never lint these.
    ignores: ['node_modules/**', 'data/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        fetch: 'readonly',
      },
    },
    rules: {
      // The codebase intentionally uses `_`-prefixed and unused catch bindings.
      'no-unused-vars': ['warn', {
        args: 'none',
        caughtErrors: 'none',
        varsIgnorePattern: '^_',
      }],
      // `try { ... } catch { /* ignore */ }` is a deliberate pattern here.
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // ANSI colour helpers legitimately use raw escape sequences.
      'no-control-regex': 'off',
      'no-console': 'off',
    },
  },
];
