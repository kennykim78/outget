// 공개 카탈로그 로드 상태(L5). 로드 중·실패면 폼을 비활성화한다 — 실패 시 안내(스펙33 §5.2, 계획 F2-2).
//   주소는 ws-data catalogUrl(동일 출처·정확 패턴만 — engine.ts), 외부 요청 0(불변식 ①).
import { useEffect, useState } from 'react';
import { loadSpecCatalog, type SpecCatalog } from './engine';

export type SpecCatalogState =
  | { status: 'loading' }
  | { status: 'ready'; value: SpecCatalog }
  | { status: 'failed' };

export function useSpecCatalog(catalogUrl: string): SpecCatalogState {
  const [state, setState] = useState<SpecCatalogState>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    loadSpecCatalog(catalogUrl).then(
      (value) => {
        if (live) setState({ status: 'ready', value });
      },
      () => {
        if (live) setState({ status: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [catalogUrl]);
  return state;
}
