import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { SelectionDetails } from './panels/SelectionDetails';
import type { HomeWorkspaceState } from './useHomeWorkspace';

/** Non-modal details keep the upper map usable; the full navigation drawer is separate. */
export function MobileDetails({ workspace }: { workspace: HomeWorkspaceState }) {
  const scroll = useRef<HTMLDivElement>(null);
  const { selection, panel, mobilePanelOpen } = workspace;
  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
  }, [selection]);
  if (!selection || panel !== 'explore' || mobilePanelOpen) return null;
  return (
    <aside className="mobile-details" aria-label={t('workspace.stopAndRouteDetails')}>
      <div className="mobile-details__content" ref={scroll}>
        <SelectionDetails workspace={workspace} />
      </div>
    </aside>
  );
}
