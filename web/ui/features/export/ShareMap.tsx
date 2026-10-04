import { useEffect, useRef, useState } from 'react';
import { mapLinkHash, type Selection, type MapTools } from '../../commute';
import type { MapFilterValues } from '../map/MapFilters';

export function ShareMap({
  selection,
  filters,
  contextRoute,
  tools,
}: {
  selection?: Selection;
  filters: MapFilterValues;
  contextRoute?: string;
  tools?: MapTools;
}) {
  const [message, setMessage] = useState('');
  const [fallback, setFallback] = useState('');
  const request = useRef(0);
  useEffect(() => {
    request.current++;
    setMessage('');
    setFallback('');
  }, [
    selection?.kind,
    selection?.id,
    filters,
    contextRoute,
    tools?.panel,
    tools?.fromId,
    tools?.toId,
  ]);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function share() {
    const current = ++request.current;
    const url = new URL(window.location.href);
    url.hash = mapLinkHash(selection, filters, contextRoute, tools);
    try {
      await navigator.clipboard.writeText(url.href);
      if (current === request.current) {
        setFallback('');
        setMessage('Map link copied');
      }
    } catch {
      if (current === request.current) {
        setFallback(url.href);
        setMessage('Select and copy this map link');
      }
    }
  }
  return (
    <div className="share-map">
      <button className="action-button" onClick={() => void share()}>
        ↗ Share map
      </button>
      <span role="status">{message}</span>
      {fallback && (
        <input
          aria-label="Shareable map link"
          readOnly
          value={fallback}
          onFocus={(event) => event.target.select()}
        />
      )}
    </div>
  );
}
