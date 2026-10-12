import { useEffect } from 'react';
import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { AccountRequired, useAccount } from '../accounts/auth';
import { AppTemplate } from '../../templates/AppTemplate';
import { SlaFeature } from './SlaFeature';

/** The /sla page (docs/sla-stories.md Epic 8, E8S5): a USA-status.com-style
 * status page for delivered service — a filterable list of streetcar routes
 * (expandable to their stops), each with little green/yellow/red boxes, one
 * per recorded day (or wider boxes per week) — plus the live tier: thin
 * slivers for the recorder's rolling 30-minute window at each strip's right
 * edge. The report is precomputed (one fetch); the live tier reads the
 * recorder's already-published live state and does its math in the
 * browser — the server never computes an SLA number at request time.
 *
 * The page is members-only while it is in beta (nav-v2): the router gates
 * `GET /api/v1/sla/report` behind the verified session, and the page mirrors
 * it with its own sign-in gate — no session, no report request at all. */
export function SlaPage() {
  useLanguage();
  useEffect(() => {
    document.title = t('sla.pageTitle');
  });
  const account = useAccount();
  return (
    <AppTemplate current="sla">
      <main className="sla-page">
        <h1>{t('sla.reportTitle')}</h1>
        <p className="sla-beta-warning" role="note">
          {t('sla.betaWarning')}
        </p>
        {!account.loaded || !account.userId ? (
          <AccountRequired
            heading={t('sla.signInHeading')}
            helper={t('sla.signInBody')}
          />
        ) : (
          <SlaFeature />
        )}
      </main>
    </AppTemplate>
  );
}
