import { clientConfig } from '../../services/http/config';
import { snapshotKey, removeSnapshot } from '../../services/cache/snapshots';

export const accountDocumentKey = (userId: string, path: string) =>
  snapshotKey(`account:${userId}`, path, clientConfig().apiOrigin);

/** Sign-out removes private disk copies. A different identity never reads these keys. */
export async function forgetAccountDocuments(userId: string) {
  await Promise.all(
    ['/api/v1/me/stops', '/api/v1/me/journal'].map((path) =>
      removeSnapshot(accountDocumentKey(userId, path)),
    ),
  );
}
