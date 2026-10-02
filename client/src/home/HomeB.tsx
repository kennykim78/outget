// 홈 B(동물 선택, 스펙22 §3.2 · UX §3.1 B): 컨텍스트 헤더(섹션 아님) → ① 지금 필요한 것 → ② 처음 준비한다면 → ③ 기준에 맞는 준비물
//   → ④ 우리 동네 병원 → ⑤ 저장 배너. 데이터는 ws-data 그대로(상품·구성안 재정렬·재판정 없음, 불변식 ③).
//   2질문(L3) 전: 개수 숫자 0 — ① 부제 "필수 준비를 먼저 확인해요", 칩 neutral, 상태 줄 = oneLiner, ⑤ 부제 없음.
//   route.typeId ≠ 저장된 ws.animalType 이면 저장 + species_selected{via:'url'} 1회(selection 이 같은 값이면 생략).
import { useEffect, useMemo, useRef } from 'react';
import type { PublicAnimalType, PublicRequirement, WsPageData } from '@ws/engine';
import { COPY, formatCopy } from '@ws/copy';
import { useAnimalSelection } from '../animal/selection';
import { productSpecLines } from '../app/staticText';
import { deriveChecklist, type ItemState } from '../checklist/derive';
import { useSetup } from '../checklist/setupStore';
import { track } from '../events/track';
import AnimalAvatar from '../ui/AnimalAvatar';
import { copyAt, copyFmt } from '../ui/copyText';
import RailSection from '../ui/RailSection';
import BundleCard from './BundleCard';
import NeedChip, { type NeedState } from './NeedChip';
import ProductCard from './ProductCard';

const STATE_OF: Record<ItemState, NeedState> = { READY: 'ready', FIRST: 'first', CHECK: 'check', LATER: 'later' };
// 칩 정렬(D-5): 미완료(! → △) → ✓. 같은 순위는 deriveChecklist 순서(orderHint → 입력 순서) 유지.
const CHIP_RANK: Record<NeedState, number> = { first: 0, check: 1, later: 2, neutral: 2, ready: 3 };

export interface HomeBProps {
  page: WsPageData;
  type: PublicAnimalType;
  capturedMain: string | null;
  onOpenL1(): void;
  onOpenL2(): void;
}

export default function HomeB({ page, type, capturedMain, onOpenL1, onOpenL2 }: HomeBProps) {
  const { setup } = useSetup(type.id);
  const selection = useAnimalSelection(page.data.types);
  const answered = setup !== null && setup.answeredAt !== null;

  // URL 로 들어온 동물을 저장(다르면 1회).
  const syncedRef = useRef(false);
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    if (selection.typeId !== type.id) selection.select(type.id, 'url');
  }, [selection, type.id]);

  const reqs: PublicRequirement[] = useMemo(() => page.data.requirements.filter((r) => r.animalTypeId === type.id), [page.data.requirements, type.id]);
  const view = useMemo(() => deriveChecklist(reqs, setup), [reqs, setup]);
  const requiredRows = view.groups.find((g) => g.priority === 'REQUIRED')?.rows ?? [];

  const chips = requiredRows
    .map((row, i) => ({ row, i, state: answered ? STATE_OF[row.state] : ('neutral' as NeedState) }))
    .sort((a, b) => CHIP_RANK[a.state] - CHIP_RANK[b.state] || a.i - b.i);

  const remaining = view.remainingRequired;
  // '필수 준비 끝'·완료 블록은 REQUIRED ≥ 1 이고 전부 ✓ 일 때만(△ 는 미완료) — REQUIRED 0 인 시드가 거짓 완료를 띄우지 않게(K1).
  const allDone = view.requiredTotal >= 1 && view.allRequiredReady;
  // 숫자 문구는 L3 응답 후에만(answeredAt — 건너뛰기 포함). REQUIRED 0 이면 숫자 줄 없음.
  const countLine = answered && view.requiredTotal >= 1 ? (allDone ? copyAt('homeB.nowDone') : copyFmt('homeB.nowRemaining', { n: remaining })) : null;
  const nowSub = answered ? countLine : COPY.homeB.nowBeforeSetup;
  const situation = setup && setup.firstTime !== null ? COPY.situation[setup.firstTime ? 'FIRST_TIME' : 'ALREADY'] : null;
  const statusTail = countLine;
  const statusLine = answered ? (statusTail ? [situation, statusTail].filter(Boolean).join(' · ') : null) : type.oneLiner;
  const alias = type.aliases[0] ? copyFmt('homeB.aliasLine', { alias: type.aliases[0] }) : null;

  const products = page.data.products; // ws-data 순서 그대로(재정렬 금지).
  const specLines = useMemo(() => productSpecLines(capturedMain), [capturedMain]);
  const itemOf = (supplyItemId: string) => reqs.find((r) => r.supplyItemId === supplyItemId)?.item;

  const ownedIds = new Set(setup?.owned ?? []);
  const bundles = page.data.bundles;

  // bundle_viewed — 카드가 절반 이상 보이면 tier 별 1회.
  const mainRef = useRef<HTMLElement>(null);
  const viewedTiers = useRef(new Set<string>());
  useEffect(() => {
    const root = mainRef.current?.querySelector('section[data-ws-section="bundles"]');
    if (!root || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const tier = (e.target as HTMLElement).dataset.wsTier;
          if (!tier || viewedTiers.current.has(tier)) continue;
          viewedTiers.current.add(tier);
          track('bundle_viewed', { animalTypeId: type.id, tier });
        }
      },
      { threshold: 0.5 },
    );
    for (const li of Array.from(root.querySelectorAll('li[data-ws-tier]'))) io.observe(li);
    return () => io.disconnect();
  }, [bundles, type.id]);

  const prev = copyAt('rail.prev');
  const next = copyAt('rail.next');
  const deviceOnly = copyAt('homeB.deviceOnly');
  const doneTitle = copyAt('homeB.doneTitle');
  const doneCta = copyAt('homeB.doneCta');

  return (
    <main ref={mainRef} className="ws-page ws-home-b" data-ws-route={page.route.kind} data-ws-type={type.id}>
      <section className="ws-context" data-ws-id={`animalTypes#${type.id}`} aria-labelledby="ws-context-title">
        <AnimalAvatar asset={type.mascot} size="lg" tone="peach-soft" alt="" />
        <h1 id="ws-context-title" className="ws-t-display">
          {type.displayName}
        </h1>
        {alias ? <p className="ws-t-meta ws-muted">{alias}</p> : null}
        {statusLine ? <p className="ws-t-body ws-muted ws-context-status">{statusLine}</p> : null}
        <button type="button" className="ws-btn ws-btn--outline" data-ws-action="change-animal" onClick={onOpenL1}>
          {COPY.nav.changeFriend}
        </button>
      </section>

      {/* ① 지금 필요한 것 */}
      {answered && allDone && doneTitle && doneCta ? (
        <section className="ws-done" data-ws-section="now" id="ws-now" aria-labelledby="ws-sec-now-title">
          <AnimalAvatar asset={type.mascot} size="md" tone="surface" alt="" />
          <h2 id="ws-sec-now-title" className="ws-t-section">
            {doneTitle}
          </h2>
          <button type="button" className="ws-btn ws-btn--outline" onClick={onOpenL2}>
            {doneCta}
          </button>
        </section>
      ) : (
        <RailSection
          id="now"
          kind="need"
          title={COPY.homeB.nowTitle}
          subtitle={nowSub}
          more={{ label: COPY.nav.seeAll, onClick: onOpenL2 }}
          prevLabel={prev}
          nextLabel={next}
          sectionData={{ 'data-ws-answered': answered ? '1' : '0' }}
        >
          {chips.length === 0 ? (
            <li className="ws-empty-li">
              <p className="ws-t-body ws-muted">{COPY.homeB.nowEmpty}</p>
            </li>
          ) : (
            chips.map(({ row, state }) => (
              <NeedChip
                key={row.requirement.supplyItemId}
                itemId={row.requirement.supplyItemId}
                name={row.requirement.item.name}
                state={state}
                href={encodeURI(`/${type.slug}/supplies/${row.requirement.item.id}`)}
              />
            ))
          )}
        </RailSection>
      )}

      {/* ② 처음 준비한다면 */}
        <RailSection
          id="bundles"
          kind="bundle"
          title={COPY.homeB.bundlesTitle}
          more={bundles.length > 0 ? { label: COPY.setup.detailLink, href: encodeURI(`/${type.slug}/setup`) } : undefined}
          prevLabel={prev}
          nextLabel={next}
        >
          {bundles.length === 0 ? (
            <li className="ws-empty-li">
              <p className="ws-t-body ws-muted">{COPY.homeB.bundlesEmpty}</p>
            </li>
          ) : (
            bundles.map((b) => (
              <BundleCard
                key={b.id}
                bundle={b}
                remainingCount={answered && ownedIds.size > 0 ? b.itemIds.filter((id) => !ownedIds.has(id)).length : null}
              />
            ))
          )}
        </RailSection>

      {/* ③ 기준에 맞는 준비물 — "전체 ›" 없음(D-27) */}
      <RailSection id="products" kind="product" title={COPY.homeB.productsTitle} prevLabel={prev} nextLabel={next}>
        {products.length === 0 ? (
          <li className="ws-empty-li">
            <p className="ws-t-body ws-muted">{COPY.homeB.productsEmpty}</p>
          </li>
        ) : (
          products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              href={encodeURI(`/${type.slug}/products/${p.id}`)}
              specLine={specLines.get(p.id) ?? null}
              glyph={itemOf(p.supplyItemId)?.glyph ?? null}
            />
          ))
        )}
      </RailSection>

      {/* ④ 우리 동네 병원 — R4 는 링크만 */}
      <section className="ws-vet-link" data-ws-section="vet" aria-labelledby="ws-sec-vet-title">
        <h2 id="ws-sec-vet-title" className="ws-t-section">
          {COPY.homeB.vetTitle}
        </h2>
        <p>
          <a className="ws-rail-more ws-t-meta" href="/vet">
            {COPY.homeB.vetLink}
            <span aria-hidden="true"> ›</span>
          </a>
        </p>
      </section>

      {/* ⑤ 저장 배너 — 채운 CTA 페이지 유일, /save 는 텍스트 링크 */}
      <section className="ws-band ws-band--save" data-ws-section="save" aria-labelledby="ws-save-title">
        <h2 id="ws-save-title" className="ws-t-title">
          {formatCopy(COPY.homeB.saveTitle, { animal: type.displayName })}
        </h2>
        {deviceOnly ? <p className="ws-t-meta ws-muted">{deviceOnly}</p> : null}
        <button type="button" className="ws-btn ws-btn--fill" onClick={onOpenL2}>
          {COPY.homeB.saveCta}
        </button>
        <a className="ws-save-link ws-t-meta" href="/save">
          {COPY.homeB.saveLink}
        </a>
      </section>
    </main>
  );
}
