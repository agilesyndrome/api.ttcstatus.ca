import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { type ReactNode } from 'react';
import { PageFooter } from '../../components/page/PageFooter';
import { NavPanel } from '../../components/nav/NavPanel';
import { BadgesPanel } from './panels/BadgesPanel';
import { ExplorePanel } from './panels/ExplorePanel';
import { JournalPanel } from './panels/JournalPanel';
import { RoutePulsePanel } from './panels/RoutePulsePanel';
import type { HomeWorkspaceState } from './useHomeWorkspace';
import { usePhoneLayout } from '../../hooks/useMediaQuery';

/** The compact map drawer. Panel content lives in focused feature modules so
 * the same Explore, Journal, and Badges renderers can be mounted in the rail
 * and represented independently in Storybook. */
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
  const phone = usePhoneLayout();
  const { data, panel, setPanel, mobilePanelOpen, sidebar } = workspace;
  if (!data) return null;
  return (
    <aside
      className="sidebar"
      aria-label={t('workspace.stopAndRouteDetails')}
      data-open={mobilePanelOpen ? '' : undefined}
    >
      <NavPanel
        panel={panel}
        onPanel={(next) => {
          setPanel(next);
          sidebar.current?.scrollTo({ top: 0 });
        }}
      />
      <div ref={sidebar} id="sidebar-content" className="sidebar-content">
        <ExplorePanel workspace={workspace} showDetails={!phone} />
        <RoutePulsePanel workspace={workspace} />
        <JournalPanel workspace={workspace} />
        <BadgesPanel workspace={workspace} />
        <PageFooter />
        {settings && <div className="nav-settings">{settings}</div>}
      </div>
    </aside>
  );
}
