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
    // 서버 파일은 별칭(@ws/engine·@ws/copy·@ws/events·@ws/forbidden-keys)으로만 — 상대 경로로 server/ 를 넘어가지 않는다(F0 (b)).
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/server/**', '**/server'],
            message: '서버 모듈은 @ws/engine · @ws/copy · @ws/events · @ws/forbidden-keys · @ws/save-validate 별칭으로만 import 하세요.',
          },
        ],
      },
    ],
    // SEC L4(R5 B3-3): react/no-danger 동등 규칙 — eslint-plugin-react 미설치라 새 의존성 없이 core 선택자로 막는다.
    //   dangerouslySetInnerHTML 는 프리렌더 정적 본문 1곳(아래 overrides)만.
    'no-restricted-syntax': [
      'error',
      {
        selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
        message: 'dangerouslySetInnerHTML 금지(react/no-danger) — 프리렌더 정적 본문(StaticMain)만 예외.',
      },
      {
        selector: "Property[key.name='dangerouslySetInnerHTML'], Property[key.value='dangerouslySetInnerHTML']",
        message: 'dangerouslySetInnerHTML 금지(react/no-danger, createElement props 우회 포함).',
      },
    ],
  },
  overrides: [
    {
      // 예외(사유): 빌드 타임 프리렌더가 만든 같은 오리진 정적 HTML(시드 → 이스케이프된 서버 렌더)을 하이드레이션 전 그대로 유지하는
      //   컴포넌트. 사용자 입력·외부 응답은 들어가지 않는다. 파일 소유는 FE1 — 여기서 경로로만 예외(StaticLayer 는 F1-1 에서 삭제, 예외 제거).
      files: ['src/app/StaticMain.tsx'],
      rules: { 'no-restricted-syntax': 'off' },
    },
  ],
  ignorePatterns: ['dist', 'dev-dist', 'node_modules', '*.config.ts'],
};
