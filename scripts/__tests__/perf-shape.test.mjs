import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '..', 'check-perf-shape.mjs');

const face = (i) => `@font-face{font-family:P;src:url(/assets/P.subset.${i}-h.woff2) format("woff2")}`;
const faces = (n, start = 0) => Array.from({ length: n }, (_, i) => face(start + i)).join('\n');

function head() {
  return `<!doctype html><html><head><meta charset="UTF-8">
<link rel="canonical" href="https://example.com/">
<link rel="stylesheet" crossorigin href="/assets/index-aaa.css">
<link rel="preload" href="/assets/P.subset.90-h.woff2" as="font" type="font/woff2" crossorigin="">
<link rel="preload" href="/assets/P.subset.91-h.woff2" as="font" type="font/woff2" crossorigin="">
<script defer src="/assets/ws-boot-bbb.js"></script>
<noscript><link rel="stylesheet" href="/assets/ws-fonts-ccc.css"></noscript>
</head><body></body></html>`;
}

const localFace = (extra = 'unicode-range:U+AC00-D7A3;') =>
  `@font-face{font-family:"WS Fallback Malgun";src:local("Malgun Gothic");size-adjust:86.43%;${extra}}`;
const locals = () => Array.from({ length: 4 }, () => localFace()).join('\n');

function fixture() {
  const d = mkdtempSync(join(tmpdir(), 'perfshape-'));
  mkdirSync(join(d, 'assets'));
  mkdirSync(join(d, 'vet'));
  writeFileSync(join(d, 'assets', 'index-aaa.css'), faces(2, 90) + '\n' + locals());
  writeFileSync(join(d, 'assets', 'ws-fonts-ccc.css'), faces(92));
  writeFileSync(join(d, 'assets', 'ws-boot-bbb.js'), '');
  for (let i = 0; i < 92; i++) writeFileSync(join(d, 'assets', `P.subset.${i}-h.woff2`), '');
  for (const f of ['index.html', 'shell.html', '404.html', 'vet/index.html']) writeFileSync(join(d, f), head());
  return d;
}
const run = (dir) => spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });

test('정상 픽스처 -> exit 0', () => {
  const d = fixture();
  try {
    const r = run(d);
    assert.equal(r.status, 0, r.stderr);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('변이: module script 복원 -> exit 1', () => {
  const d = fixture();
  try {
    const p = join(d, 'vet', 'index.html');
    writeFileSync(
      p,
      readFileSync(p, 'utf8').replace('</head>', '<script type="module" crossorigin src="/assets/ws-boot-bbb.js"></script></head>'),
    );
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /vet\/index\.html.*module/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('변이: index CSS 에 @font-face 전체 복원 -> exit 1', () => {
  const d = fixture();
  try {
    writeFileSync(join(d, 'assets', 'index-aaa.css'), faces(92));
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /index-aaa\.css.*@font-face 92/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});


test('index CSS 에 local() 대체 face(unicode-range 있음)는 웹폰트 2개 계산에서 빠진다 -> exit 0', () => {
  const d = fixture();
  try {
    writeFileSync(join(d, 'assets', 'index-aaa.css'), faces(2, 90) + '\n' + locals());
    const r = run(d);
    assert.equal(r.status, 0, r.stderr);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('변이: local() 대체 face 에 unicode-range 없음 -> exit 1', () => {
  const d = fixture();
  try {
    writeFileSync(join(d, 'assets', 'index-aaa.css'), faces(2, 90) + '\n' + localFace('') + localFace() + localFace() + localFace());
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unicode-range 없음/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('변이: index CSS 에 url face 3개(대체 face 가 url 을 가짐) -> exit 1', () => {
  const d = fixture();
  try {
    writeFileSync(join(d, 'assets', 'index-aaa.css'), faces(2, 90) + '\n' + face(17) + '\n' + locals());
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /index-aaa\.css.*@font-face 3/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('변이: index·ws-fonts 외 lazy 청크 CSS -> exit 1', () => {
  const d = fixture();
  try {
    writeFileSync(join(d, 'assets', 'AnimalPicker-ddd.css'), '.x{color:red}');
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /AnimalPicker-ddd\.css.*외 CSS/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('외부 url 폰트 -> exit 1', () => {
  const d = fixture();
  try {
    writeFileSync(
      join(d, 'assets', 'ws-fonts-ccc.css'),
      faces(91) + '\n@font-face{font-family:X;src:url(https://cdn.example.com/x.woff2)}',
    );
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /외부/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test(
  '실제 client/dist (있으면) -> exit 0',
  { skip: !existsSync(resolve(here, '../../client/dist/index.html')) },
  () => {
    const r = run(resolve(here, '../../client/dist'));
    assert.equal(r.status, 0, r.stderr);
  },
);

test('변이: local() 대체 face 가 빠짐(import 주석 처리 등) -> exit 1', () => {
  const d = fixture();
  try {
    writeFileSync(join(d, 'assets', 'index-aaa.css'), faces(2, 90));
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /local\(\) 대체 @font-face 0개/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('변이: local() 대체 face unicode-range 가 라틴까지 덮음 -> exit 1', () => {
  const d = fixture();
  try {
    writeFileSync(join(d, 'assets', 'index-aaa.css'), faces(2, 90) + '\n' + localFace('unicode-range:U+0000-FFFF;') + localFace() + localFace() + localFace());
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /한글 밖/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
