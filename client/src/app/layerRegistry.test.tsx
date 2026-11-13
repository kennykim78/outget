// app/layerRegistry — L1·L2·L4·L5·L7·L8 항목, 기본 제목은 copy.ts 단일 소스, LayerHost 안에서 렌더 안전(빈 데이터 포함).
import { COPY } from '@ws/copy';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { golden, pageOf, product, req } from '../test/fixtures';
import LayerHost from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';
import { LayerPageProvider } from './layerPage';
import { layerRegistry, layerWsId } from './layerRegistry';

afterEach(() => act(() => layerStore.resetForTest()));

function host(page = pageOf('HOME', { types: [] })) {
  return render(
    <LayerPageProvider page={page}>
      <LayerHost registry={layerRegistry} />
    </LayerPageProvider>,
  );
}

describe('layerRegistry', () => {
  it('L1·L2·L4·L5·L7·L8, 고정 제목 = copy', () => {
    expect(Object.keys(layerRegistry).sort()).toEqual(['L1', 'L2', 'L4', 'L5', 'L7', 'L8']);
    expect(layerRegistry.L1.title).toBe(COPY.picker.title);
    expect(layerRegistry.L2.title).toBe(COPY.homeB.nowTitle);
    expect(layerRegistry.L5.title).toBe(COPY.checkLayer.title);
    expect(layerRegistry.L8.title).toBe(COPY.save.title);
  });

  it.each(['L1', 'L2', 'L5', 'L8'] as const)('%s: 빈 데이터에서도 렌더 안전', async (k) => {
    host();
    act(() => layerStore.open(k));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it.each(['L4', 'L7'] as const)('%s: ws-data 에 대상이 없으면 레이어를 닫는다', async (k) => {
    host();
    act(() => layerStore.open(k, { typeId: golden.id, itemId: 'none', productId: 'none' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('layerWsId: L4·L5 = supplyRequirements#{requirementId}, L7 = curatedProducts#{id}, 없으면 null', () => {
    const page = pageOf('TYPE', { requirements: [req('cage', 'REQUIRED', '케이지')], products: [product('p1', 'cage')] }, { typeId: golden.id });
    expect(layerWsId(page, 'L4', { typeId: golden.id, itemId: 'cage' })).toBe('supplyRequirements#req-cage');
    expect(layerWsId(page, 'L5', { typeId: golden.id, itemId: 'cage' })).toBe('supplyRequirements#req-cage');
    expect(layerWsId(page, 'L7', { typeId: golden.id, productId: 'p1' })).toBe('curatedProducts#p1');
    expect(layerWsId(page, 'L4', { typeId: golden.id, itemId: 'none' })).toBeNull();
    expect(layerWsId(page, 'L4', { typeId: 'other', itemId: 'cage' })).toBeNull();
    expect(layerWsId(page, 'L2', {})).toBeNull();
  });

  it('L4 제목 = 용품명, L7 제목 = 상품명 + data-ws-id', () => {
    const page = pageOf('TYPE', { requirements: [req('cage', 'REQUIRED', '케이지')], products: [product('p1', 'cage', '합성 케이지')] }, { typeId: golden.id });
    host(page);
    act(() => layerStore.open('L4', { typeId: golden.id, itemId: 'cage' }));
    expect(screen.getByRole('dialog', { name: '케이지' })).toHaveAttribute('data-ws-layer', 'L4');
    act(() => layerStore.open('L7', { typeId: golden.id, productId: 'p1' }));
    const d = screen.getByRole('dialog', { name: '합성 케이지' });
    expect(d).toHaveAttribute('data-ws-id', 'curatedProducts#p1');
  });
});
