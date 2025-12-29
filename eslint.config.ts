import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import type { Linter } from 'eslint';

const config: Linter.Config[] = [
    eslint.configs.recommended,
    {
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: {
                console: 'readonly',
                document: 'readonly',
                window: 'readonly',
                Audio: 'readonly',
                HTMLImageElement: 'readonly',
                HTMLAudioElement: 'readonly',
                NodeJS: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint as any,
            'react': reactPlugin,
            'react-hooks': reactHooksPlugin as any,
        },
        rules: {
            // TypeScript 规则
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',

            // React 规则
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',
            'react/jsx-uses-react': 'off',
            'react/jsx-uses-vars': 'error',

            // React Hooks 规则
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',

            // 通用规则
            'no-console': 'off',
            'no-unused-vars': 'off', // 使用 @typescript-eslint/no-unused-vars
            'prefer-const': 'warn',
            'no-var': 'error',
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
    },
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'py_modules/**',
            'out/**',
            '*.js',
            '*.cjs',
            '*.mjs',
        ],
    },
];

export default config;
