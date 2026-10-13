import { ref } from '../../../../shared/contracts/schema';

const errors = { default: { $ref: '#/components/responses/Error' } };
const response = (name: string, description = 'Success') => ({
  description,
  content: { 'application/json': { schema: ref(name) } },
});
const query = (name: string, schema: unknown = { type: 'string' }) => ({
  in: 'query',
  name,
  required: false,
  schema,
});
const conditional = {
  in: 'header',
  name: 'If-None-Match',
  required: false,
  schema: { type: 'string' },
};
const selectors = [query('tag'), query('artifact', { type: 'integer', minimum: 1 })];
const releaseMap = query('map', {
  enum: ['streetcar', 'snake', 'ttcstatus'],
  default: 'ttcstatus',
});
const cacheHeaders = {
  ETag: {
    schema: { type: 'string' },
    description: 'Quoted content validator; weak client validators are accepted.',
  },
  'X-Network-Version': {
    schema: { type: 'integer' },
    description: 'Static network version for map/directory responses.',
  },
  'X-Map-Artifact': {
    schema: { type: 'integer' },
    description: 'Matching immutable map/directory identity.',
  },
  'X-Map-Format': { schema: { type: 'string' } },
  'X-Schema-Version': { schema: { type: 'integer' } },
  'X-Live-Update-Seconds': {
    schema: { type: 'integer' },
    description: 'Client polling cadence, in seconds.',
  },
  'X-Live-Next-Update-At': {
    schema: { type: 'string', format: 'date-time' },
    description: 'Next recorder publication boundary for live responses.',
  },
};
const cachedHead = (parameters: unknown[] = []) => ({
  parameters: [...parameters, conditional],
  responses: {
    '200': { description: 'Artifact metadata; no body.', headers: cacheHeaders },
    '304': { description: 'Matching ETag; no body.', headers: cacheHeaders },
    default: { description: 'HTTP error; no response body for HEAD.' },
  },
});
const cachedGet = (name: string, parameters: unknown[] = []) => ({
  parameters: [...parameters, conditional],
  responses: {
    '200': { ...response(name), headers: cacheHeaders },
    '304': { description: 'Matching ETag; no body.', headers: cacheHeaders },
    ...errors,
  },
});
const ownerGet = (name: string) => ({
  security: [{ ClerkSession: [] }],
  responses: { '200': response(name), ...errors },
});
const write = (input: string, output: string, conflict?: string) => ({
  security: [{ ClerkSession: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: ref(input) } },
  },
  responses: {
    '200': response(output),
    ...(conflict
      ? {
          '409': response(
            conflict,
            'Revision conflict. Retain the draft; compare with current, merge, then retry with its revision.',
          ),
        }
      : {}),
    ...errors,
  },
});

export const publicPaths = {
  '/api/healthz': {
    get: { responses: { '200': response('Health'), ...errors } },
    head: { responses: { '200': { description: 'Healthy; no body.' }, ...errors } },
  },
  '/api/v1/version': {
    get: { responses: { '200': response('WorkerVersion'), ...errors } },
  },
  '/api/v1/network': { get: { responses: { '200': response('Network'), ...errors } } },
  '/api/v1/openapi.json': {
    get: {
      responses: {
        '200': {
          description: 'This OpenAPI document.',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    },
  },
  '/api/v1/auth/config': {
    get: { responses: { '200': response('AuthConfig'), ...errors } },
  },
  '/api/v1/manifest': {
    get: {
      parameters: [releaseMap, query('tag')],
      responses: { '200': response('ReleaseManifest'), ...errors },
    },
  },
  '/api/v1/stops': {
    get: cachedGet('StopDirectory', [releaseMap, ...selectors]),
    head: cachedHead([releaseMap, ...selectors]),
  },
  '/api/v1/map/streetcar': {
    get: cachedGet('SchematicMap', [...selectors, query('format')]),
    head: cachedHead([...selectors, query('format')]),
  },
  '/api/v1/map/snake': {
    get: cachedGet('ViewerMap', [...selectors, query('format')]),
    head: cachedHead([...selectors, query('format')]),
  },
  '/api/v1/map/ttcstatus': {
    get: cachedGet('ViewerMap', [...selectors, query('format')]),
    head: cachedHead([...selectors, query('format')]),
  },
  // No /api/v1/vehicles/streetcar: the public vehicle path moved to the
  // CDN-served live tick documents (docs/optimize-transport.md change 1/3);
  // the Worker route is deleted, not flagged. Nothing here can read the
  // recorder per request.
  // No /api/v1/service/stops: the stops payload is public broadcast data
  // served from the CDN-published live tick documents
  // (docs/optimize-overlay.md E3S3); the Worker route is deleted, not
  // flagged — the live tick path is the only transport, and nothing on
  // this surface can read the recorder's states per request.
  '/api/v1/service/wave': { get: cachedGet('ServiceWave', [query('routes')]) },
  '/api/v1/service/history': {
    get: cachedGet('ServiceHistory', [
      query('stop'),
      query('routes'),
      query('from', { type: 'integer', description: 'UTC epoch milliseconds.' }),
    ]),
  },
  '/api/v1/event': {
    post: {
      requestBody: {
        required: true,
        content: { 'application/json': { schema: ref('AnalyticsEvent') } },
      },
      responses: { '204': { description: 'Accepted action; no body.' }, ...errors },
    },
  },
  '/api/v1/profiles/{username}': {
    get: {
      parameters: [
        { in: 'path', name: 'username', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': response('PublicProfile'), ...errors },
    },
  },
};

export const accountPaths = {
  '/api/v1/sla/report': {
    get: {
      ...cachedGet('SlaReport', [query('route')]),
      security: [{ ClerkSession: [] }],
      'x-stability': 'experimental',
    },
  },
  '/api/v1/me/stops': {
    get: ownerGet('SavedStopsDocument'),
    put: write('SavedStopsWrite', 'RevisionResult', 'SavedStopsConflict'),
  },
  '/api/v1/me/journal': {
    get: ownerGet('JournalDocument'),
    put: write('JournalWrite', 'RevisionResult', 'JournalConflict'),
  },
  '/api/v1/me/profile': {
    get: ownerGet('Profile'),
    put: write('ProfileWrite', 'Profile'),
  },
  '/api/v1/me/features': { get: ownerGet('FeatureFlags') },
};

// Operator surfaces accept public agency data, never device GPS. They are outside
// the mobile account contract and use a separate deployment credential.
export const operationalPaths = {
  '/api/v1/feed/status': {
    get: {
      security: [{ OperatorToken: [] }],
      responses: { '200': response('FeedDiagnostics'), ...errors },
    },
  },
  '/api/v1/admin/sync': {
    post: {
      security: [{ OperatorToken: [] }],
      responses: { '200': response('SyncResult'), ...errors },
    },
  },
  '/api/v1/debug/map/streetcar.svg': {
    post: {
      security: [{ OperatorToken: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: ref('SchematicMap') } },
      },
      responses: {
        '200': {
          description: 'Debug SVG of public transit geography.',
          content: { 'image/svg+xml': { schema: { type: 'string' } } },
        },
        ...errors,
      },
    },
  },
};
