import { useEffect, useState } from 'react';

const toolbarHeight = 64;

type CompactPageTitle = {
  title: string;
  visible: boolean;
};

type CompactPageTitleState = CompactPageTitle & {
  pathname: string;
};

export function useCompactPageTitle(
  pathname: string,
  fallbackTitle: string,
  enabled = true,
): CompactPageTitle {
  const [state, setState] = useState<CompactPageTitleState>({
    pathname,
    title: fallbackTitle,
    visible: false,
  });

  useEffect(() => {
    if (!enabled) return undefined;

    const heading = document.querySelector<HTMLElement>('#main-content h1');
    if (!heading) return undefined;

    const headingTitle = () => heading.textContent?.trim() || fallbackTitle;
    const updateTitle = () => setState((current) => ({
      pathname,
      title: headingTitle(),
      visible: current.pathname === pathname ? current.visible : false,
    }));

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        const hasScrolledAboveToolbar =
          !entry.isIntersecting && entry.boundingClientRect.bottom <= toolbarHeight;
        setState({ pathname, title: headingTitle(), visible: hasScrolledAboveToolbar });
      },
      {
        root: null,
        rootMargin: `-${toolbarHeight}px 0px 0px 0px`,
        threshold: 0,
      },
    );
    intersectionObserver.observe(heading);

    const mutationObserver = new MutationObserver(updateTitle);
    mutationObserver.observe(heading, { childList: true, subtree: true, characterData: true });

    return () => {
      intersectionObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [enabled, fallbackTitle, pathname]);

  return state.pathname === pathname
    ? { title: state.title, visible: state.visible }
    : { title: fallbackTitle, visible: false };
}
