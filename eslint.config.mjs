import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

export default ts.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'work/**',
      'materials/**',
      'research/**',
      'art/**',
      'docs/**',
      '.qwen/**',
      'runs/_*.cjs',
      'tools/_scratch*',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  { files: ['**/*.mjs'], rules: { 'no-undef': 'error' } },
  {
    files: [
      'config/**/*.ts',
      'tests/**/*.ts',
      'packages/**/*.ts',
      'tools/{format,audit-assets,check-toolchain,check-plan}.mjs',
      'tools/check-config.ts',
    ],
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
  // Narrow legacy-tool exceptions; gameplay code and all new modules retain recommended rules.
  { files: ['tools/import-{cards,levels,roster}.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  {
    files: ['tools/gen-art.ts'],
    rules: { '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }] },
  },
  { files: ['tools/ai-bench.ts'], rules: { 'prefer-const': 'off' } },
  { files: ['tools/calibrate.ts'], rules: { 'no-irregular-whitespace': 'off' } },
  { files: ['tools/{e2e-browser.mjs,net-tests.ts,physics-tests.ts}'], rules: { 'no-useless-assignment': 'off' } },
  { files: ['tools/e2e-browser.mjs'], rules: { 'no-empty': ['error', { allowEmptyCatch: true }] } },
);
