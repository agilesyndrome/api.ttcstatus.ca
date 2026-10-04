import { useEffect, useRef } from 'react';

export function useShortcuts(enabled: boolean, actions: Record<string, () => void>) {
  const handlers = useRef(actions);
  handlers.current = actions;
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (
        !enabled ||
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        document.querySelector('dialog[open]')
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest('input, textarea, select, [role="combobox"]') ||
          target.isContentEditable)
      )
        return;
      const action = handlers.current[event.key.toLowerCase()];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', press);
    return () => window.removeEventListener('keydown', press);
  }, [enabled]);
}
