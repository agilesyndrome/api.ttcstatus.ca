import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { type ReactNode } from 'react';
import { PageFooter } from '../../components/page/PageFooter';
import { NavPanel } from '../../components/nav/NavPanel';
import { ExplorePanel } from './panels/ExplorePanel';
import type { HomeWorkspaceState } from './useHomeWorkspace';

/** The compact map drawer keeps navigation and map controls together. Data
 * views and selected details render in the main workspace. */
export function HomeSidebar({
  workspace,
  settings,
}: {
  workspace: HomeWorkspaceState;
  /** Header controls (language, shortcuts, account) rendered at the bottom
   * of the mobile nav; CSS hides them where the topbar already shows them. */
  settings?: ReactNode;
}) {
  useLanguage();
  const { data, panel, setPanel, mobilePanelOpen, sidebar } = workspace;
  if (!data) return null;
  return (
    <aside
      ref={sidebar}
      className="sidebar"
      aria-label={t('workspace.stopAndRouteDetails')}
      data-open={mobilePanelOpen ? '' : undefined}
    >
      <div id="sidebar-content" className="sidebar-content">
        <NavPanel
          panel={panel}
          onPanel={(next) => {
            setPanel(next);
            sidebar.current?.scrollTo({ top: 0 });
          }}
          panels={{
            explore: <ExplorePanel workspace={workspace} />,
          }}
        />
        <PageFooter />
        {settings && <div className="nav-settings">{settings}</div>}
      </div>
    </aside>
  );
}
