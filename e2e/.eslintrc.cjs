/* E2E eslint config (legacy .eslintrc, ESLint 8) — npm run lint:e2e 가 -c 로 지정해 e2e/ 와 playwright.config.ts 에 쓴다. */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    // 플레이라이트 픽스처 시그니처는 첫 인자 구조 분해가 필수다(`async ({}, use) => …`).
    'no-empty-pattern': 'off',
  },
};
