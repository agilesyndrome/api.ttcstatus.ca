import { useEffect } from 'react';

export function useViewportHeight() {
  useEffect(() => {
    const update = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-viewport-height', `${height}px`);
    };
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--app-viewport-height');
    };
  }, []);
}
