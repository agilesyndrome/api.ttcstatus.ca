import { t } from '../../../i18n';
import { useLanguage } from '../../../i18n/react';
import { StreetcarJournal } from '../../journal/StreetcarJournal';
import { AccountRequired } from '../../accounts/auth';
import { DraftRecovery } from '../../accounts/DraftRecovery';
import type { HomeWorkspaceState } from '../useHomeWorkspace';

/** The map workspace's Journal content, shared by the rail and mobile drawer. */
export function JournalPanel({ workspace }: { workspace: HomeWorkspaceState }) {
  useLanguage();
  const {
    data,
    accountJournal,
    journal,
    journalTarget,
    journalDraftNumber,
    setJournal,
    cars,
    feed,
    panel,
    selectVehicle,
  } = workspace;
  if (!data) return null;
  return (
    <div
      id="panel-journal"
      role="tabpanel"
      aria-label={t('workspace.streetcarJournal')}
      hidden={panel !== 'journal'}
    >
      <AccountRequired>
        <DraftRecovery document={accountJournal} />
        {accountJournal.error && (
          <div className="tip" role="alert">
            {t(accountJournal.error)}
          </div>
        )}
        {(accountJournal.saving || accountJournal.error || !accountJournal.ready) && (
          <p className="microcopy" role="status">
            {accountJournal.saving
              ? t('workspace.savingYourJournal')
              : accountJournal.error === 'journal.unavailable'
                ? ''
                : accountJournal.error
                  ? t('workspace.yourLastChangeHasNotBeenSaved')
                  : t('workspace.loadingYourJournal')}
          </p>
        )}
        <fieldset className="journal-fieldset" disabled={!accountJournal.ready}>
          {workspace.accountJournal.cached && (
            <p role="status" className="account-cache-status">
              {t('cache.accountOffline')}
            </p>
          )}
          <StreetcarJournal
            key={accountJournal.userId}
            entries={journal}
            focusVehicleId={journalTarget}
            prefillCarNumber={journalDraftNumber}
            cars={cars}
            routes={data.routes}
            active={feed.active}
            loaded={Boolean(feed.snapshot)}
            failed={feed.failed}
            onChange={setJournal}
            onSelect={(car) => selectVehicle(car, true)}
          />
        </fieldset>
        <a className="account-link" href="/settings">
          {t('workspace.profileAndBadgePrivacySettings')}
        </a>
      </AccountRequired>
    </div>
  );
}
