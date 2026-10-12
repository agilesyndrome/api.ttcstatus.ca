import { english } from '../../../../../shared/i18n/messages';

export async function mapFailure(response: Response) {
  const cause: unknown = await response.json().catch(() => null);
  if (
    response.status === 503 &&
    cause &&
    typeof cause === 'object' &&
    'error' in cause &&
    cause.error === 'map-generating'
  )
    return english('map.theStreetcarMapIsBeingPreparedPleaseTryAgainShortly');
  return english('map.mapTemporarilyUnavailableWhileWePerformTrackWork');
}
