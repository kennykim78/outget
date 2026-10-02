// app/layerRegistry — L1·L2 항목, 기본 제목은 copy.ts 단일 소스, LayerHost 안에서 렌더 안전(빈 데이터 포함).
import { COPY } from '@ws/copy';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { pageOf } from '../test/fixtures';
import LayerHost from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';
import { LayerPageProvider } from './layerPage';
import { layerRegistry } from './layerRegistry';

afterEach(() => act(() => layerStore.resetForTest()));

describe('layerRegistry', () => {
  it('L1·L2 만, 제목 = copy', () => {
    expect(Object.keys(layerRegistry).sort()).toEqual(['L1', 'L2']);
    expect(layerRegistry.L1.title).toBe(COPY.homeA.heroCta);
    expect(layerRegistry.L2.title).toBe(COPY.homeB.nowTitle);
  });

  it.each(['L1', 'L2'] as const)('%s: 빈 데이터에서도 렌더 안전', (k) => {
    render(
      <LayerPageProvider page={pageOf('HOME', { types: [] })}>
        <LayerHost registry={layerRegistry} />
      </LayerPageProvider>,
    );
    act(() => layerStore.open(k));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
