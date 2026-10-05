import { usePreference } from '../hooks/usePreferences';

export function AffiliationNotice() {
  const [dismissed, setDismissed] = usePreference(
    'ttc:affiliation-notice:v1',
    false,
    (value): value is boolean => typeof value === 'boolean',
  );
  if (dismissed) return null;
  return (
    <aside className="affiliation-notice" aria-label="Independent site notice">
      <div>
        <strong>An independent transit project</strong>
        <p>
          TTCstatus is not officially affiliated with, endorsed by, or operated by the
          Toronto Transit Commission (TTC).
        </p>
      </div>
      <button className="action-button" onClick={() => setDismissed(true)}>
        Got it
      </button>
    </aside>
  );
}
