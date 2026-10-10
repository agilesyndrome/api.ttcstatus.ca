import { useEffect, useState } from 'react';
import type {
  SlaReportResponse,
  SlaStopReport,
} from '../../../../shared/service/contracts';

/** One fetch per route per session: the report is precomputed and
 * minutes-scale cached at the edge — the page never polls, never recomputes,
 * and makes exactly one request per view (the precompute IS the freshness). */
const reportCache = new Map<string, SlaReportResponse>();
const stopsCache = new Map<string, SlaStopReport[]>();

export interface SlaReportState {
  report: SlaReportResponse | null;
  failed: boolean;
}

export function useSlaReport(): SlaReportState {
  const [report, setReport] = useState<SlaReportResponse | null>(
    () => reportCache.get('') ?? null,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (reportCache.has('')) {
      setReport(reportCache.get('') ?? null);
      setFailed(false);
      return;
    }
    let stopped = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/v1/sla/report', {
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'omit',
        });
        if (!response.ok) throw new Error(`sla report HTTP ${response.status}`);
        const payload = (await response.json()) as SlaReportResponse;
        reportCache.set('', payload);
        if (!stopped) {
          setReport(payload);
          setFailed(false);
        }
      } catch {
        if (!stopped) {
          setReport(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, []);
  return { report, failed };
}

export interface SlaStopsState {
  stops: SlaStopReport[] | null;
  failed: boolean;
}

/** A snapshot of the session's loaded route details — the filter's stop-name
 * memory. Plain map read; the needles that re-run the filter re-read it. */
export function loadedStopsByRoute(): Map<string, SlaStopReport[]> {
  return new Map(stopsCache);
}

/** The expandable per-route stop detail — fetched once per route per session
 * (`?route=`), cached module-level so collapsing and re-expanding is free. */
export function useSlaStops(routeId: string | null): SlaStopsState {
  const [stops, setStops] = useState<SlaStopReport[] | null>(() =>
    routeId ? (stopsCache.get(routeId) ?? null) : null,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!routeId) {
      setStops(null);
      setFailed(false);
      return;
    }
    if (stopsCache.has(routeId)) {
      setStops(stopsCache.get(routeId) ?? null);
      setFailed(false);
      return;
    }
    let stopped = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/sla/report?route=${encodeURIComponent(routeId)}`,
          {
            signal: controller.signal,
            cache: 'no-store',
            credentials: 'omit',
          },
        );
        if (!response.ok) throw new Error(`sla stops HTTP ${response.status}`);
        const payload = (await response.json()) as SlaReportResponse & {
          stops?: SlaStopReport[];
        };
        stopsCache.set(routeId, payload.stops ?? []);
        if (!stopped) {
          setStops(payload.stops ?? []);
          setFailed(false);
        }
      } catch {
        if (!stopped) {
          setStops(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [routeId]);
  return { stops, failed };
}
