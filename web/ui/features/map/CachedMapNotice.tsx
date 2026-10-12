import { t, getLocale } from '../../i18n';
import { useActivity } from '../../services/platform/react';
import { useLanguage } from '../../i18n/react';
import type { HomeWorkspaceState } from './useHomeWorkspace';

export function CachedMapNotice({ workspace }: { workspace: HomeWorkspaceState }) {
  useLanguage();
  const activity = useActivity();
  if (!workspace.cached || !workspace.savedAt) return null;
  return (
    <div className="cached-map-notice" role="status">
      {t(
        workspace.refreshing
          ? 'cache.mapRefreshing'
          : activity.online
            ? 'cache.mapUnavailable'
            : 'cache.mapOffline',
      )}{' '}
      {t('cache.mapSaved', {
        date: new Date(workspace.savedAt).toLocaleString(getLocale()),
      })}
      {!workspace.refreshing && (
        <button onClick={workspace.retryMap}>{t('common.retry')}</button>
      )}
    </div>
  );
}
