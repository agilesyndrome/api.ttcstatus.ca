import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { PageFooter } from './PageFooter';

/** The shell shown when the app cannot establish its required auth service. */
export function TrackWork({ onRetry }: { onRetry?: () => void }) {
  useLanguage();
  return (
    <main className="track-work" aria-labelledby="track-work-title">
      <div className="track-work__scene" aria-hidden="true">
        <span className="track-work__rail track-work__rail--near" />
        <span className="track-work__rail track-work__rail--far" />
        <span className="track-work__work-light">⚠</span>
      </div>
      <div className="track-work__content">
        <p className="eyebrow">{t('header.ttcStatusMap')}</p>
        <h1 id="track-work-title">
          {t('trackWork.pleaseWaitWhileWePerformTrackMaintenance')}
        </h1>
        {onRetry && (
          <button className="action-button" onClick={onRetry}>
            {t('common.retry')}
          </button>
        )}
        <PageFooter />
      </div>
    </main>
  );
}
