/// <reference types="vite/client" />

interface ImportMetaEnv {
  // 네이버 지도 JS v3 Client ID. env 전용 — 하드코딩 금지.
  readonly VITE_NAVER_MAP_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
