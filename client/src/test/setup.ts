// Vitest + Testing Library 전역 설정. jest-dom 매처(toBeInTheDocument 등) 등록.
import '@testing-library/jest-dom';
import { beforeAll } from 'vitest';

// R7 O1: 레이어 내용·/vet 은 지연 청크. 운영에서는 boot 가 첫 화면 청크를 기다린 뒤 렌더하고(firstScreen), 레이어는 열 때 받는다.
//   테스트는 동기 렌더 단언(act 안 boot·layerStore.open 직후 getBy*)을 유지하도록 파일마다 미리 불러 둔다 — 불러온 청크는
//   preloadable 이 Suspense 없이 같은 렌더에 그린다. 미로딩 경로(부팅 대기·껍데기 fallback)는 app/firstScreen.test 가 새 모듈 그래프로 검증.
//   import 는 beforeAll 안(테스트 파일의 vi.mock 등록 뒤)에서만 — 설정 파일이 모듈을 먼저 캐시해 목을 우회하지 않게.
beforeAll(async () => {
  if (typeof window === 'undefined') return; // @vitest-environment node 파일(빌드 도구 테스트)은 React 화면을 그리지 않는다.
  const [{ LAYER_KINDS }, { preloadLayer }, { vetPageChunk }] = await Promise.all([
    import('../ui/layer/useLayer'),
    import('../app/layerRegistry'),
    import('../app/pageChunks'),
  ]);
  await Promise.all([...LAYER_KINDS.map((k) => preloadLayer(k)), vetPageChunk.preload()]);
}, 30000);
