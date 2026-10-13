import { t } from '../../../i18n';
import { useLanguage } from '../../../i18n/react';
import { SlaFeature } from '../../sla/SlaFeature';
import { AccountRequired } from '../../accounts/auth';
import type { HomeWorkspaceState } from '../useHomeWorkspace';

/** The map workspace's Status content (the former /sla page, docs/sla-stories.md
 * Epic 8): the delivered-service report as one more destination beside Explore,
 * Route Pulse and Journal — the same workspace pane, the same card treatment.
 * Members-only while in beta: the report request is gated server-side and the
 * panel mirrors it with the sign-in gate. */
export function SlaPanel({ workspace }: { workspace: HomeWorkspaceState }) {
  useLanguage();
  const { data, panel } = workspace;
  if (!data) return null;
  return (
    <div
      id="panel-sla"
      role="tabpanel"
      aria-label={t('navigation.status')}
      className="sla-panel"
      hidden={panel !== 'sla'}
    >
      <h2>{t('sla.reportTitle')}</h2>
      <p className="sla-beta-warning" role="note">
        {t('sla.betaWarning')}
      </p>
      <AccountRequired heading={t('sla.signInHeading')} helper={t('sla.signInBody')}>
        <SlaFeature />
      </AccountRequired>
    </div>
  );
}
