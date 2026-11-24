// 362 N4 — parseTitleSpec(몰 원제목 → 규격 값) fail-closed 시험. 옵션 나열·후보 2개 이상·단위 혼재 → null(판단 불가).
//   C4: mm 는 매핑표가 mm 필드를 둔 품목(cage·bird-cage barGapMm, perch diameterMm)에서만, cm 와 한 제목에 섞이면 null.
import { describe, expect, it } from 'vitest';
import { TITLE_SPEC_ITEMS, parseTitleSpec } from '../engine/title-spec.js';

describe('parseTitleSpec — 숫자', () => {
  it('쳇바퀴 단일 cm + 통면 → 지름·바닥면', () => {
    expect(parseTitleSpec('wheel', '30cm 통면 쳇바퀴')).toEqual({ diameterCm: 30, surface: 'SOLID' });
    expect(parseTitleSpec('wheel', '햄스터 쳇바퀴 지름 27 cm 막힌판 스탠드')).toEqual({ diameterCm: 27, surface: 'SOLID', mount: 'STAND' });
  });

  it('옵션 나열·후보 2개 이상 → null', () => {
    expect(parseTitleSpec('wheel', '햄스터 쳇바퀴 21/27/30cm')).toBeNull();
    expect(parseTitleSpec('wheel', '햄스터 쳇바퀴 S/M/L')).toBeNull();
    expect(parseTitleSpec('wheel', '햄스터 쳇바퀴 21cm 27cm')).toBeNull();
    expect(parseTitleSpec('wheel', '햄스터 쳇바퀴 20~30cm')).toBeNull();
    expect(parseTitleSpec('wheel', '햄스터 쳇바퀴 사이즈 선택')).toBeNull();
    expect(parseTitleSpec('cage', '리빙박스 100x50cm 80x40cm')).toBeNull();
  });

  it('단위 없는 숫자는 쓰지 않는다', () => {
    expect(parseTitleSpec('wheel', '햄스터 쳇바퀴 30 통면')).toEqual({ surface: 'SOLID' });
  });

  it('cm·mm 혼재 → null, 인치 → null', () => {
    expect(parseTitleSpec('cage', '철망 케이지 100x50x50cm 간격 9mm')).toBeNull();
    expect(parseTitleSpec('wheel', '쳇바퀴 30cm 두께 5mm')).toBeNull();
    expect(parseTitleSpec('wheel', '쳇바퀴 12인치')).toBeNull();
    expect(parseTitleSpec('wheel', '쳇바퀴 12"')).toBeNull();
  });

  it('간격 mm 는 cage·bird-cage 매핑에서만 barGapMm', () => {
    expect(parseTitleSpec('cage', '철망 케이지 간격 12mm')).toEqual({ type: 'WIRE', barGapMm: 12 });
    expect(parseTitleSpec('bird-cage', '철망 새장 간격 12mm')).toEqual({ type: 'WIRE', barGapMm: 12 });
    expect(parseTitleSpec('wheel', '쳇바퀴 간격 12mm')).toBeNull();
    expect(parseTitleSpec('playpen', '울타리 간격 12mm')).toBeNull();
    // 간격 표지 없는 mm → null(어느 필드인지 모른다)
    expect(parseTitleSpec('cage', '철망 케이지 12mm')).toBeNull();
  });

  it('가로×세로(×높이) cm → 바닥 가로·세로·높이', () => {
    expect(parseTitleSpec('cage', '리빙박스 100x50cm')).toEqual({ type: 'LIVING_BOX', floorWcm: 100, floorDcm: 50 });
    expect(parseTitleSpec('cage', '대형 리빙박스 120×60×50cm')).toEqual({ type: 'LIVING_BOX', floorWcm: 120, floorDcm: 60, heightCm: 50 });
    expect(parseTitleSpec('cage', '케이지 100*50*45cm')).toEqual({ floorWcm: 100, floorDcm: 50, heightCm: 45 });
    expect(parseTitleSpec('playpen', '기니피그 울타리 120x60cm')).toEqual({ floorWcm: 120, floorDcm: 60 });
    expect(parseTitleSpec('bird-cage', '아크릴 새장 60x40x70cm')).toEqual({ type: 'ACRYLIC', widthCm: 60, depthCm: 40, heightCm: 70 });
    // 치수 외 cm 숫자가 더 있으면 null(어느 값인지 모른다)
    expect(parseTitleSpec('cage', '리빙박스 100x50cm 높이 40cm')).toBeNull();
    // 단위 없는 치수는 쓰지 않는다
    expect(parseTitleSpec('cage', '리빙박스 100x50')).toEqual({ type: 'LIVING_BOX' });
  });

  it('튜브는 내경 표지가 있을 때만', () => {
    expect(parseTitleSpec('tubes', '햄스터 터널 내경 6cm')).toEqual({ innerDiameterCm: 6 });
    expect(parseTitleSpec('tubes', '햄스터 터널 100cm')).toEqual({});
  });

  it('횃대 mm, cm 섞이면 null', () => {
    expect(parseTitleSpec('perch', '자연목 횃대 지름 15mm')).toEqual({ diameterMm: 15, material: 'NATURAL_BRANCH' });
    expect(parseTitleSpec('perch', '횃대 길이 20cm 지름 15mm')).toBeNull();
  });

  it('목욕통은 안쪽 표지·깊이 표지만', () => {
    expect(parseTitleSpec('bird-bath', '앵무새 목욕통 안쪽 지름 15cm')).toEqual({ shortSideCm: 15 });
    expect(parseTitleSpec('bird-bath', '앵무새 목욕통 깊이 4cm')).toEqual({ depthCm: 4 });
    expect(parseTitleSpec('bird-bath', '앵무새 목욕통 20x15cm')).toBeNull();
  });
});

describe('parseTitleSpec — enum 긍정 사전', () => {
  it('베딩 재질·무향', () => {
    expect(parseTitleSpec('bedding', '종이 베딩 무향 10L')).toEqual({ material: 'PAPER', scented: false, volumeL: 10 });
    expect(parseTitleSpec('bedding', '아스펜 베딩')).toEqual({ material: 'ASPEN' });
    expect(parseTitleSpec('bedding', '소나무 베딩')).toEqual({ material: 'CEDAR_PINE' });
    // 서로 다른 재질 2개 → null
    expect(parseTitleSpec('bedding', '종이 아스펜 혼합 베딩')).toBeNull();
    // 긍정어 없음 → 키 없음
    expect(parseTitleSpec('bedding', '햄스터 베딩')).toEqual({});
  });

  it('갉기·은신처·모래욕', () => {
    expect(parseTitleSpec('chew', '무처리 나무 갉기 장난감')).toEqual({ material: 'UNTREATED_WOOD' });
    expect(parseTitleSpec('chew', '원목 갉기 장난감')).toEqual({});
    expect(parseTitleSpec('hideout', '도자기 은신처')).toEqual({ material: 'CERAMIC' });
    expect(parseTitleSpec('hideout', '플라스틱 은신처')).toEqual({ material: 'PLASTIC' });
    expect(parseTitleSpec('sand-bath', '친칠라 샌드 목욕 모래')).toEqual({ sandType: 'CHINCHILLA_SAND' });
  });

  it('통면·망형 동시 → null', () => {
    expect(parseTitleSpec('wheel', '쳇바퀴 30cm 통면 메쉬')).toBeNull();
  });

  it('매핑 없는 품목 → 빈 값, 비문자 입력 → null', () => {
    expect(parseTitleSpec('water-bottle', '급수기 500ml')).toEqual({});
    expect(parseTitleSpec('wheel', 42 as unknown as string)).toBeNull();
  });

  it('매핑표 품목 집합 고정', () => {
    expect([...TITLE_SPEC_ITEMS].sort()).toEqual(
      ['bedding', 'bird-bath', 'bird-cage', 'cage', 'chew', 'hideout', 'perch', 'playpen', 'sand-bath', 'tubes', 'wheel'].sort(),
    );
  });
});
