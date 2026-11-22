// 301 — 시드 원천 규칙: budget-tips.json references[i].url 만 외부 URL 예외(글 페이지 규칙 통과분), REFERENCE 행은 어간도 FAIL.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCANNER = join(ROOT, 'scripts', 'compliance-scan.mjs');
const made = [];
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

const ref = (url) => ({ title: '만들기 기록', url, siteName: '블로그', checkedAt: '2026-11-20' });
function scanTip(over) {
  const root = mkdtempSync(join(tmpdir(), 'ws-301-src-'));
  made.push(root);
  mkdirSync(join(root, 'server', 'seed'), { recursive: true });
  mkdirSync(join(root, 'server', 'src', 'seed'), { recursive: true });
  copyFileSync(join(ROOT, 'server', 'src', 'seed', 'banned-words.json'), join(root, 'server', 'src', 'seed', 'banned-words.json'));
  const row = {
    id: 't1', kind: 'REFERENCE', careProfileId: 'cp', supplyItemId: 'cage', substitute: '수납함', sourceHint: 'AT_HOME',
    materials: ['물품'], steps: ['단계'], dimensions: [], cautions: ['주의'], hazards: [], mustCheck: [],
    references: [ref('https://namu.wiki/w/test-1')],
    reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null, contentKind: 'CARE', source: [], ...over,
  };
  writeFileSync(join(root, 'server', 'seed', 'budget-tips.json'), JSON.stringify([row]));
  const r = spawnSync(process.execPath, [SCANNER, '--root', root, '--json', '--now', '2026-11-22'], { encoding: 'utf8' });
  return JSON.parse(r.stdout).findings.filter((f) => f.severity === 'FAIL' && f.file === 'server/seed/budget-tips.json');
}

test('글 페이지 원문 URL 은 C1-SEEDURL 예외', () => {
  assert.deepEqual(scanTip({}), []);
});

test('판매처·상품·제휴 URL, references 밖 URL 은 C1-SEEDURL FAIL', () => {
  for (const url of ['https://www.coupang.com/vp/products/1', 'https://namu.wiki/w/p?aff=1', 'https://namu.wiki/shop/1', 'http://namu.wiki/w/p']) {
    assert.ok(scanTip({ references: [ref(url)] }).some((f) => f.rule === 'C1-SEEDURL'), url);
  }
  assert.ok(scanTip({ cautions: ['https://blog.example.com/x'] }).some((f) => f.rule === 'C1-SEEDURL'));
});

test('REFERENCE 행은 DRAFT 여도 금지어 어간 FAIL(검수 없이 노출되는 경로)', () => {
  assert.ok(scanTip({ cautions: ['이건 안전해요'] }).some((f) => f.rule === 'C4-STEM'));
});

// 308(306 D4): 단축 URL·판매처 호스트 + 제휴 단축 호스트(coupa.ng)는 시드 references 에서도 FAIL.
//   coupa.ng 리터럴 자체는 C10-AFF-HOST(허용 파일만) — 엔진 차단 목록엔 넣지 않고 이 원천 규칙이 잡는다.
test('제휴 단축 호스트(coupa.ng·link.coupang.com) 원문 URL 은 C10-AFF-HOST FAIL', () => {
  for (const url of ['https://coupa.ng/abc123', 'https://link.coupang.com/a/xyz']) {
    const f = scanTip({ references: [ref(url)] });
    assert.ok(f.some((x) => x.rule === 'C10-AFF-HOST'), `${url} ${JSON.stringify(f.map((x) => x.rule))}`);
  }
});

test('단축 URL·쇼핑 호스트 원문 URL 은 C1-SEEDURL FAIL(엔진·seed-exposure 차단 목록과 같은 판정)', () => {
  for (const url of ['https://bit.ly/3abc', 'https://naver.me/xYz', 'https://tinyurl.com/abc', 'https://me2.do/abc', 'https://www.danawa.com/p/1', 'https://shopping.naver.com/x', 'https://ohou.se/productions/1', 'https://namu.wiki./w/1']) {
    const f = scanTip({ references: [ref(url)] });
    assert.ok(f.some((x) => x.rule === 'C1-SEEDURL'), `${url} ${JSON.stringify(f.map((x) => x.rule))}`);
  }
});

// 312(310 MED-2): 글 사이트 허용 목록(TIP_ARTICLE_HOSTS) 밖·IP 리터럴 원문 URL 은 C1-SEEDURL FAIL, 안이면 통과.
test('허용 목록 밖 호스트·IP 리터럴 원문 URL 은 C1-SEEDURL FAIL', () => {
  for (const url of ['https://amzn.asia/x', 'https://a.co/x', 'https://t.ly/x', 'https://www.google.com/url?q=https://namu.wiki/w/x', 'https://web.archive.org/web/2026/https://namu.wiki/w/x', 'https://blog.example.com/p/1', 'https://1.2.3.4/x', 'https://[::1]/x']) {
    const f = scanTip({ references: [ref(url)] });
    assert.ok(f.some((x) => x.rule === 'C1-SEEDURL'), `${url} ${JSON.stringify(f.map((x) => x.rule))}`);
  }
});

test('허용 목록 5개 사이트(서브도메인 포함) 원문 URL 은 FAIL 0', () => {
  for (const url of ['https://namu.wiki/w/x', 'https://brunch.co.kr/@a/1', 'https://mirochuu.com/a/', 'https://gall.dcinside.com/board/view/?id=animal&no=1', 'https://www.vegannews.co.kr/news/article.html?no=1']) {
    assert.deepEqual(scanTip({ references: [ref(url)] }), [], url);
  }
});
