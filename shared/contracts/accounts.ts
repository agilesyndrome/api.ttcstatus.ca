import {
  array,
  boolean,
  object,
  ref,
  revision,
  string,
  timestamp,
  version,
} from './schema';

const text = (maximum: number, minimum = 0) => ({
  ...string,
  minLength: minimum,
  maxLength: maximum,
});
const stopIds = { ...array(text(200, 1)), maxItems: 100, uniqueItems: true };
const entries = {
  ...array(ref('JournalEntry')),
  maxItems: 500,
  description: 'vehicleId is unique within a journal.',
};

export const accountSchemas = {
  JournalEntry: object(
    {
      vehicleId: text(200, 1),
      label: text(200, 1),
      recordedAt: {
        ...timestamp,
        maxLength: 40,
        description: 'Canonical UTC timestamp, e.g. 2026-10-12T17:00:00.000Z.',
      },
      note: text(1000),
      status: { enum: ['seen', 'ridden'] },
      routeId: text(200),
      routeNumber: text(200),
      routeName: text(200),
      overnight: boolean,
    },
    ['vehicleId', 'label', 'recordedAt', 'note'],
    false,
  ),
  JournalDocument: object({ entries, revision }),
  JournalWrite: object({ entries, revision }, undefined, false),
  SavedStopsDocument: object({ stopIds, revision }),
  SavedStopsWrite: object({ stopIds, revision }, undefined, false),
  RevisionResult: object({ revision }),
  JournalConflict: object({
    error: { const: 'journal-conflict' },
    revision,
    current: ref('JournalDocument'),
  }),
  SavedStopsConflict: object({
    error: { const: 'saved-stops-conflict' },
    revision,
    current: ref('SavedStopsDocument'),
  }),
  Profile: object({ username: string, publicBadges: boolean }),
  ProfileWrite: object(
    {
      username: { ...string, pattern: '^[a-z0-9][a-z0-9_-]{2,29}$' },
      publicBadges: boolean,
    },
    undefined,
    false,
  ),
  PublicProfile: object({
    username: string,
    badges: array(object({ name: string, icon: string, description: string })),
  }),
  FeatureFlags: object({ schemaVersion: version, flags: array(string) }),
  // The `live` block is additive transport discovery (optimize-transport.md
  // change 1b): the only source of the live host, cadence, and path template.
  AuthConfig: object({
    enabled: boolean,
    publishableKey: { type: ['string', 'null'] },
    live: object(
      {
        base: { ...string, description: 'Live host origin; empty string means same-origin.' },
        pathTemplate: {
          ...string,
          description: 'Immutable tick path with {tick} placeholder; never carries query parameters.',
        },
        updateSeconds: { type: 'integer', description: 'Client polling cadence in seconds (30–300).' },
      },
      ['base', 'pathTemplate', 'updateSeconds'],
    ),
  }),
  AnalyticsEvent: object(
    {
      action: {
        enum: [
          'located',
          'tracked-streetcar',
          'played-snake',
          'saved-stop',
          'removed-stop',
          'exported-map',
        ],
      },
    },
    undefined,
    false,
  ),
};
