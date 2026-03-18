import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: ['node_modules/**', 'vendor/**', 'tests/output/**', 'test-results/**']
    },
    js.configs.recommended,
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                pako: 'readonly',
                JSZip: 'readonly'
            }
        },
        rules: {
            'no-console': 'off',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
        }
    },
    {
        files: ['tests/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.node, ...globals.browser }
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
        }
    },
    {
        files: ['playwright.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...globals.node }
        },
        rules: {
            'no-unused-vars': 'warn'
        }
    }
];
