import { t } from '../../../i18n';
import { useLanguage } from '../../../i18n/react';
import { Badges } from '../../journal/Badges';
import { AccountRequired } from '../../accounts/auth';
import type { HomeWorkspaceState } from '../useHomeWorkspace';

/** The map workspace's Badges content, shared by the rail and mobile drawer. */
export function BadgesPanel({ workspace }: { workspace: HomeWorkspaceState }) {
  useLanguage();
  const { data, journal, panel } = workspace;
  if (!data) return null;
  return (
    <div
      id="panel-badges"
      role="tabpanel"
      aria-label={t('navigation.badges')}
      hidden={panel !== 'badges'}
    >
      <AccountRequired>
        <Badges entries={journal} />
      </AccountRequired>
    </div>
  );
}
