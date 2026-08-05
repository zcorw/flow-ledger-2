import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCompactPageTitle } from './useCompactPageTitle';

let intersectionCallback: IntersectionObserverCallback;
let observedHeading: Element | null;

class IntersectionObserverMock {
  readonly root = null;
  readonly rootMargin = '-64px 0px 0px 0px';
  readonly thresholds = [0];

  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback;
  }

  disconnect = vi.fn();
  observe = vi.fn((element: Element) => {
    observedHeading = element;
  });
  takeRecords = vi.fn(() => []);
  unobserve = vi.fn();
}

function reportHeadingPosition(isIntersecting: boolean, bottom: number) {
  act(() => {
    intersectionCallback(
      [
        {
          isIntersecting,
          boundingClientRect: { bottom } as DOMRectReadOnly,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  });
}

beforeEach(() => {
  observedHeading = null;
  document.body.innerHTML = '<main id="main-content"><h1>首页看板</h1></main>';
  vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('useCompactPageTitle', () => {
  it('shows the compact title only after the page heading scrolls above the toolbar', () => {
    const { result } = renderHook(() => useCompactPageTitle('/', '首页看板'));

    expect(observedHeading?.textContent).toBe('首页看板');
    expect(result.current).toEqual({ title: '首页看板', visible: false });

    reportHeadingPosition(false, 63);
    expect(result.current.visible).toBe(true);

    reportHeadingPosition(true, 90);
    expect(result.current.visible).toBe(false);

    reportHeadingPosition(false, 700);
    expect(result.current.visible).toBe(false);
  });

  it('tracks a dynamic page heading such as a history entity name', async () => {
    const { result } = renderHook(() => useCompactPageTitle('/history', '历史快照'));
    const heading = document.querySelector('h1');

    act(() => {
      if (heading) heading.textContent = '示例账户';
    });

    await waitFor(() => expect(result.current.title).toBe('示例账户'));
  });
});
