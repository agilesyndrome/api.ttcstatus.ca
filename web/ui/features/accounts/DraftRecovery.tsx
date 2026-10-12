import { t } from '../../i18n';

interface Props {
  hasDraft: boolean;
  canRetryDraft: boolean;
  retryDraft(preferDraft?: boolean): Promise<boolean>;
  discardDraft(): Promise<void>;
}

/** Explicit recovery remains available outside a disabled editing fieldset. */
export function DraftRecovery({ document }: { document: Props }) {
  if (!document.hasDraft) return null;
  return (
    <div className="tip" role="status">
      <p>{t('accountDraft.retained')}</p>
      <button
        className="action-button"
        disabled={!document.canRetryDraft}
        onClick={() => void document.retryDraft()}
      >
        {t('accountDraft.retry')}
      </button>{' '}
      <button
        className="action-button"
        disabled={!document.canRetryDraft}
        onClick={() => void document.retryDraft(true)}
      >
        {t('accountDraft.keepMine')}
      </button>{' '}
      <button className="action-button" onClick={() => void document.discardDraft()}>
        {t('accountDraft.discard')}
      </button>
    </div>
  );
}
