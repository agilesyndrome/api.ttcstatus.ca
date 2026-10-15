import type { Env } from '../env';
import {
  overlayTransportConfig,
  liveTickPath,
  tickIdAt,
} from '../../../../shared/live/config';
import type { StopServiceState } from '../../../../shared/service/contracts';
import type { StopsTickDocument } from '../service/stops-tick-doc';
import { resolveMapArtifact } from '../maps/artifacts';
import type { ExecutionContextLike } from '../../../shared/cloudflare/bindings';
import { serviceHistoryResponse } from '../service/responses';

export const LITE_WIDTH = 79;
const esc = (value: unknown): string =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const line = (value = '') => value.slice(0, LITE_WIDTH);
const pad = (value: unknown, width: number) => String(value).padStart(width, ' ');
const mins = (value: number | null) => (value === null ? '--' : `${Math.round(value)}m`);
const routeOf = (state: StopServiceState) => state.routeIds[0] ?? 'unknown';
const dryness = (state: StopServiceState) =>
  state.dryness === null ? '--' : `${state.dryness.toFixed(1)}x`;
const stopLabel = (id: string, names: Map<string, string>) => names.get(id) ?? id;
const stopInitial = (label: string) => label.trim().charAt(0).toUpperCase() || '?';
function stopIndexLetters(label: string): string[] {
  const normalized = label.trim();
  const letters = new Set([stopInitial(normalized)]);
  const at = normalized.match(/\bat\s+([^\s]+)/i);
  if (at?.[1]) letters.add(stopInitial(at[1]));
  return [...letters];
}

export function rankStops(states: readonly StopServiceState[]): StopServiceState[] {
  return states
    .filter((state) => ['due', 'void'].includes(state.state) && state.dryness !== null)
    .sort(
      (a, b) =>
        Number(b.state === 'void') - Number(a.state === 'void') ||
        (b.dryness ?? 0) - (a.dryness ?? 0) ||
        (b.irregularity ?? 0) - (a.irregularity ?? 0) ||
        (b.minutesSince ?? 0) - (a.minutesSince ?? 0),
    );
}

function titleRows(title: string, tick: StopsTickDocument | null): string[] {
  const stamp = tick
    ? new Date(tick.at).toISOString().replace('T', ' ').slice(0, 19)
    : 'no field';
  return [
    line(` TTC SERVICE BOARD - ${title}`),
    line(` field tick ${tick?.tickId ?? '--'} (${stamp} UTC) - refreshes every 30 s`),
    '='.repeat(LITE_WIDTH),
  ];
}
function footer(): string[] {
  return [
    '='.repeat(LITE_WIDTH),
    ' [S] stop lookup   [R] route index   [C] closures   [M] the sheet',
    ' lite v0.2 | no cookies | no location | observed, not promised',
  ];
}
function page(title: string, body: string[], tick: StopsTickDocument | null): string {
  const form =
    '<form action="/lite" method="get">Route number: <input name="route" size="8" maxlength="8"><button type="submit">dig</button></form>';
  const text = [...titleRows(title, tick), '', ...body, '', ...footer()]
    .map(line)
    .map(esc)
    .join('\n')
    .replace(/(\/lite\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<!doctype html><html><head><meta charset="us-ascii"><title>${esc(title)}</title></head><body>${form}<pre>${text}</pre></body></html>`;
}
function stateLine(state: StopServiceState, names: Map<string, string>): string {
  return ` ${pad(state.stopId, 6)}  ${stopLabel(state.stopId, names).slice(0, 18).padEnd(18)} ${routeOf(state).padEnd(8)} ${mins(state.minutesSince).padStart(4)} ${dryness(state).padStart(5)} ${state.state.toUpperCase().padEnd(5)} /lite/stop/${encodeURIComponent(state.stopId)}`;
}
function routeIndex(states: readonly StopServiceState[]): string[] {
  const routes = new Map<string, number>();
  for (const state of states)
    for (const route of state.routeIds) routes.set(route, (routes.get(route) ?? 0) + 1);
  return [...routes.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(
      ([route, count]) =>
        ` ${route.padEnd(8)} ${pad(count, 4)} stops  /lite/r/${encodeURIComponent(route)}`,
    );
}
function armKey(state: StopServiceState): string {
  return `${routeOf(state)}:${state.directionId}`;
}
function armRows(
  states: readonly StopServiceState[],
  names: Map<string, string>,
): string[] {
  const groups = new Map<string, StopServiceState[]>();
  for (const state of states) {
    const group = groups.get(armKey(state)) ?? [];
    group.push(state);
    groups.set(armKey(state), group);
  }
  return [...groups.entries()]
    .map(([key, rows]) => {
      const watched = rows.filter(
        (row) => !['unmonitored', 'collecting'].includes(row.state),
      );
      const bad = watched.filter((row) => ['due', 'void'].includes(row.state));
      const worst = rankStops(rows)[0];
      return {
        key,
        rows,
        score: watched.length ? bad.length / watched.length : 0,
        text: ` ${key.replace(':', ' dir ')}  watched ${pad(watched.length, 3)}  due+void ${pad(bad.length, 3)}  worst ${worst ? `${mins(worst.minutesSince)} ${dryness(worst)}` : '--'}`,
      };
    })
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, 20)
    .flatMap((arm) => [
      arm.text,
      `   /lite/arm/${encodeURIComponent(arm.key.split(':')[0])}/${arm.key.split(':')[1]}`,
      ...rankStops(arm.rows)
        .slice(0, 5)
        .map((state) => `   ${stateLine(state, names)}`),
    ]);
}
function closureRows(states: readonly StopServiceState[], now: number): string[] {
  const groups = new Map<string, StopServiceState[]>();
  for (const state of states) {
    const group = groups.get(armKey(state)) ?? [];
    group.push(state);
    groups.set(armKey(state), group);
  }
  return [...groups.entries()]
    .map(([key, rows]) => {
      const watched = rows.filter(
        (row) => !['unmonitored', 'collecting'].includes(row.state),
      );
      const qualifies =
        watched.length > 0 &&
        watched.every(
          (row) =>
            row.state === 'void' &&
            row.lastTouchAt !== null &&
            now - row.lastTouchAt >= 30 * 60_000,
        );
      if (!qualifies) return null;
      return ` ${key.replace(':', ' dir ')} - no car observed through ${watched.length} watched stop(s) since ${new Date(Math.min(...watched.map((row) => row.lastTouchAt!))).toISOString().slice(11, 19)} UTC`;
    })
    .filter((row): row is string => row !== null);
}
function routePage(
  route: string,
  states: readonly StopServiceState[],
  names: Map<string, string>,
  tick: StopsTickDocument,
): string {
  const routeStates = states.filter((state) => state.routeIds.includes(route));
  const letters = new Map<string, number>();
  for (const state of routeStates) {
    for (const letter of stopIndexLetters(stopLabel(state.stopId, names)))
      letters.set(letter, (letters.get(letter) ?? 0) + 1);
  }
  return page(
    `ROUTE ${route}`,
    [
      ` ROUTE ${route}`,
      '',
      ' Pick the FIRST LETTER of the stop name.',
      '',
      ...[...letters.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([letter, count]) =>
            ` [${letter}] ${count} stops  /lite/r/${encodeURIComponent(route)}/${letter}`,
        ),
    ],
    tick,
  );
}
function letterPage(
  route: string,
  letter: string,
  states: readonly StopServiceState[],
  names: Map<string, string>,
  tick: StopsTickDocument,
): string {
  const rows = states
    .filter(
      (state) =>
        state.routeIds.includes(route) &&
        stopIndexLetters(stopLabel(state.stopId, names)).includes(letter),
    )
    .sort((a, b) =>
      stopLabel(a.stopId, names).localeCompare(stopLabel(b.stopId, names), undefined, {
        numeric: true,
      }),
    );
  return page(
    `${route} ${letter}`,
    [
      ` ${route} - stop names starting with ${letter}`,
      '',
      ' Pick your stop:',
      '',
      ...rows.map(
        (state, index) =>
          ` [${index + 1}] ${stopLabel(state.stopId, names).slice(0, 24).padEnd(24)} ${state.state.toUpperCase().padEnd(5)} ${mins(state.minutesSince).padStart(4)} /lite/stop/${encodeURIComponent(state.stopId)}`,
      ),
    ],
    tick,
  );
}
export function renderLitePage(
  pathname: string,
  tick: StopsTickDocument,
  names = new Map<string, string>(),
  historyStrip = 'history unavailable',
): string {
  const states = tick.states;
  if (tick.outage)
    return page(
      'FIELD UNAVAILABLE',
      [
        '',
        ` FIELD UNAVAILABLE SINCE ${tick.outage.since}`,
        '',
        ' The recorder could not assemble the service field.',
        ' Rankings are withheld rather than recomputed from stale data.',
      ],
      tick,
    );
  const routeMatch = pathname.match(/^\/lite\/r\/([^/]+)(?:\/([A-Za-z]))?$/);
  if (routeMatch?.[1] && routeMatch[2])
    return letterPage(
      decodeURIComponent(routeMatch[1]),
      routeMatch[2].toUpperCase(),
      states,
      names,
      tick,
    );
  if (routeMatch?.[1])
    return routePage(decodeURIComponent(routeMatch[1]), states, names, tick);
  const armMatch = pathname.match(/^\/lite\/arm\/([^/]+)\/(\d+)$/);
  if (armMatch) {
    const rows = states.filter(
      (state) =>
        routeOf(state) === decodeURIComponent(armMatch[1]) &&
        String(state.directionId) === armMatch[2],
    );
    return page(
      `ARM ${armMatch[1]}`,
      [
        ` ARM ${decodeURIComponent(armMatch[1])} dir ${armMatch[2]}`,
        '',
        ...rankStops(rows).map((state) => stateLine(state, names)),
        '',
        ` ${rows.filter((state) => ['due', 'void'].includes(state.state)).length} stops due or void; ${rows.filter((state) => state.state === 'unmonitored').length} unmonitored.`,
      ],
      tick,
    );
  }
  if (pathname === '/lite/closures')
    return page(
      'CLOSURES',
      [
        ' CLOSURES - observed by the feed, not announced',
        '',
        ...(closureRows(states, tick.at).length
          ? closureRows(states, tick.at)
          : [' no qualifying 30-minute all-void arm observed']),
      ],
      tick,
    );
  const stopMatch = pathname.match(/^\/lite\/stop\/([^/]+)$/);
  if (stopMatch) {
    const stop = decodeURIComponent(stopMatch[1]);
    const selectedLabel = stopLabel(stop, names);
    const rows = states.filter(
      (state) =>
        state.stopId === stop ||
        (selectedLabel !== stop && stopLabel(state.stopId, names) === selectedLabel),
    );
    return page(
      `STOP ${selectedLabel}`,
      [
        ` STOP ${selectedLabel}`,
        '',
        ...rows.map(
          (state) =>
            ` ${state.stopId.padEnd(6)} ${routeOf(state)} dir ${state.directionId}  ${state.state.toUpperCase()}  since ${mins(state.minutesSince)}  typical ${state.medianHeadwayOwnSeconds === null ? '--' : `${Math.round(state.medianHeadwayOwnSeconds / 60)}m`}  now ${dryness(state)}  residual ${state.expectedWaitSeconds === null ? '--' : `${Math.round(state.expectedWaitSeconds / 60)}m`}`,
        ),
        '',
        ` Last 30 min: ${historyStrip}`,
      ],
      tick,
    );
  }
  const blind = states.filter((state) => state.state === 'unmonitored').length;
  return page(
    'HOME',
    [
      ' FIND YOUR STOP',
      '-----------------------------------------------------------------------------',
      ' Enter a route number above, or use the route index below.',
      '',
      ' WORST STOPS - watched data only',
      '-----------------------------------------------------------------------------',
      ' stop    name                           route    since   now state',
      ...rankStops(states)
        .slice(0, 10)
        .map((state) => stateLine(state, names)),
      '',
      ' WORST ARMS - due and void share of watched stops',
      '-----------------------------------------------------------------------------',
      ...armRows(states, names),
      '',
      ' ROUTE INDEX',
      '-----------------------------------------------------------------------------',
      ...routeIndex(states),
      '',
      ' UNWATCHED - feed blind spots, counted not ranked',
      '-----------------------------------------------------------------------------',
      ` ${blind} directional stops currently unmonitored`,
      '',
      ' Closures: /lite/closures',
    ],
    tick,
  );
}
async function readTick(env: Env): Promise<StopsTickDocument | null> {
  if (!env.LIVE_BUCKET) return null;
  const config = overlayTransportConfig(env);
  const current = tickIdAt(Date.now(), Number(env.SERVICE_SAMPLE_SECONDS) || 30);
  for (const tickId of [current, current - 1]) {
    const object = await env.LIVE_BUCKET.get(
      liveTickPath(config.pathTemplate, tickId).replace(/^\//, ''),
    );
    if (!object) continue;
    try {
      return JSON.parse(await new Response(object.body).text()) as StopsTickDocument;
    } catch {
      return null;
    }
  }
  return null;
}

async function readStopNames(env: Env): Promise<Map<string, string>> {
  try {
    const resolved = await resolveMapArtifact(env, 'streetcar');
    if (resolved && !resolved.error) {
      const chunks = (
        await env.DB.prepare(
          'SELECT payload FROM map_stop_directory_chunks WHERE artifact_id = ? ORDER BY chunk_index',
        )
          .bind(resolved.artifact.id)
          .all<{ payload: string }>()
      ).results;
      if (chunks.length) {
        const directory = JSON.parse(chunks.map((chunk) => chunk.payload).join('')) as {
          stops?: Array<{ stopId: string; name: string }>;
        };
        const names = new Map(
          (directory.stops ?? []).map((stop) => [stop.stopId, stop.name]),
        );
        if (names.size) return names;
      }
    }

    // Older active artifacts may predate the published directory. The GTFS
    // rows use the same source stop IDs as the service tick, so they are a
    // safe read-only fallback for the text board.
    const rows = (
      await env.DB.prepare('SELECT stop_id, name FROM gtfs_stops')
        .all<{ stop_id: string; name: string }>()
    ).results;
    return new Map(rows.map((row) => [row.stop_id, row.name]));
  } catch {
    return new Map();
  }
}

async function readHistoryStrip(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
  stopId: string,
): Promise<string> {
  try {
    const historyRequest = new Request(
      `${new URL(request.url).origin}/api/v1/service/history?stop=${encodeURIComponent(stopId)}`,
    );
    const response = await serviceHistoryResponse(historyRequest, env, ctx);
    if (!response.ok) return 'history unavailable';
    const payload = (await response.json()) as {
      bucketSeries?: Array<{ buckets: Array<{ n: number }> }>;
    };
    const buckets = payload.bucketSeries?.[0]?.buckets ?? [];
    if (!buckets.length) return 'no observed buckets';
    return buckets
      .slice(-6)
      .map((bucket) => (bucket.n > 0 ? '#' : '.'))
      .join('');
  } catch {
    return 'history unavailable';
  }
}

export async function liteResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.searchParams.has('route') &&
    (url.pathname === '/lite' || url.pathname === '/lite/')
  )
    return Response.redirect(
      `${url.origin}/lite/r/${encodeURIComponent(url.searchParams.get('route')!.trim())}`,
      301,
    );
  const tick = await readTick(env);
  if (!tick)
    return new Response(
      page(
        'FIELD UNAVAILABLE',
        [
          ' FIELD UNAVAILABLE',
          '',
          ' The live field has not published a readable tick yet.',
        ],
        null,
      ),
      {
        // An unavailable field is a valid BBS screen, including in local
        // Wrangler where the live R2 binding may not have a tick yet.
        status: 200,
        headers: {
          'content-type': 'text/html; charset=us-ascii',
          'cache-control': 'no-store',
        },
      },
    );
  const stopMatch = url.pathname.match(/^\/lite\/stop\/([^/]+)$/);
  const historyStrip = stopMatch
    ? await readHistoryStrip(request, env, ctx, decodeURIComponent(stopMatch[1]))
    : 'history unavailable';
  return new Response(
    renderLitePage(url.pathname, tick, await readStopNames(env), historyStrip),
    {
      headers: {
        'content-type': 'text/html; charset=us-ascii',
        'cache-control': 'public, max-age=30',
      },
    },
  );
}
