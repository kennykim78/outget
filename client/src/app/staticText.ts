// 같은 문서의 프리렌더 보관분(staticCapture)에서 텍스트만 읽는다 — 규격 한 줄(specLine)은 서버 단일 함수가 만든 것을
//   그대로 쓰고(스펙22 §4-3 "단일 함수 공용"), 클라이언트에서 다시 조립하지 않는다. DOMParser(스크립트 실행 없음) + textContent 만.
export function productSpecLines(mainHtml: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!mainHtml || typeof DOMParser !== 'function') return out;
  const doc = new DOMParser().parseFromString(mainHtml, 'text/html');
  for (const li of Array.from(doc.querySelectorAll('li.ws-product[data-ws-id^="curatedProducts#"]'))) {
    const id = (li.getAttribute('data-ws-id') ?? '').slice('curatedProducts#'.length);
    const spec = li.querySelector('.ws-spec')?.textContent?.trim();
    if (id && spec) out.set(id, spec);
  }
  return out;
}
