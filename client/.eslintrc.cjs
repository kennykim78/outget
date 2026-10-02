/* eslint config (legacy .eslintrc, ESLint 8). */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    // 서버 파일은 별칭(@ws/engine·@ws/copy·@ws/events)으로만 — 상대 경로로 server/ 를 넘어가지 않는다(F0 (b)).
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/server/**', '**/server'],
            message: '서버 모듈은 @ws/engine · @ws/copy · @ws/events 별칭으로만 import 하세요.',
          },
        ],
      },
    ],
  },
  ignorePatterns: ['dist', 'dev-dist', 'node_modules', '*.config.ts'],
};
