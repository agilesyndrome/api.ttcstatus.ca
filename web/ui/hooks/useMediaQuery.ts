import { useEffect, useState } from 'react';

/** Viewport decisions are presentation concerns, shared by all responsive shells. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}
export const usePhoneLayout = () => useMediaQuery('(max-width: 640px)');
