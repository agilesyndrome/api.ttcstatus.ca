import type {
  SlaReportResponse,
  SlaRouteReport,
  SlaStopReport,
  SlaTick,
} from '../../../../shared/service/contracts';
import type { SlaLiveBucket } from './sla-live';

const band = {
  weekday: [{ fromHour: 6, toHour: 22, headwaySeconds: 360 }],
  saturday: [{ fromHour: 8, toHour: 22, headwaySeconds: 480 }],
  sunday: [{ fromHour: 9, toHour: 21, headwaySeconds: 600 }],
  holiday: null,
};

function tick(key: string, compliance: number | null, final = true): SlaTick {
  return {
    key,
    compliance,
    band:
      compliance === null
        ? 'no-data'
        : compliance >= 0.9
          ? 'met'
          : compliance >= 0.75
            ? 'degraded'
            : 'missed',
    services: compliance === null ? 0 : Math.round(compliance * 120),
    monitoredMinutes: compliance === null ? 0 : 1440,
    maxGapSeconds: compliance === null ? null : compliance < 0.75 ? 1_320 : 780,
    coverageRatio: compliance === null ? 0 : 0.96,
    final,
  };
}

export const slaStops: SlaStopReport[] = [
  {
    stopId: 'queen-spadina-east',
    name: 'Queen at Spadina',
    directionId: 0,
    headsign: 'Long Branch',
    routeIds: ['501'],
    overall: {
      compliance: 0.94,
      band: 'met',
      monitoredMinutes: 12_240,
      services: 312,
      latestDayKey: '2026-10-12',
      latestBand: 'met',
    },
    days: [
      tick('2026-10-10', 0.91),
      tick('2026-10-11', 0.95),
      tick('2026-10-12', 0.96, false),
    ],
    weeks: [tick('2026-10-05', 0.94)],
  },
  {
    stopId: 'queen-yonge-east',
    name: 'Queen at Yonge',
    directionId: 1,
    headsign: 'Neville Park',
    routeIds: ['501'],
    overall: {
      compliance: 0.78,
      band: 'degraded',
      monitoredMinutes: 11_820,
      services: 288,
      latestDayKey: '2026-10-12',
      latestBand: 'degraded',
    },
    days: [
      tick('2026-10-10', 0.72),
      tick('2026-10-11', 0.8),
      tick('2026-10-12', 0.81, false),
    ],
    weeks: [tick('2026-10-05', 0.78)],
  },
];

export const slaRoute: SlaRouteReport = {
  routeId: '501',
  number: '501',
  name: 'Queen',
  overnight: false,
  published: band,
  todayHeadways: Array.from({ length: 24 }, (_, hour) =>
    hour >= 6 && hour < 22 ? 360 : null,
  ),
  overall: {
    compliance: 0.88,
    band: 'degraded',
    monitoredMinutes: 24_060,
    services: 600,
    latestDayKey: '2026-10-12',
    latestBand: 'degraded',
  },
  days: [
    tick('2026-10-10', 0.91),
    tick('2026-10-11', 0.84),
    tick('2026-10-12', 0.89, false),
  ],
  weeks: [tick('2026-10-05', 0.88)],
};

const secondRoute: SlaRouteReport = {
  ...slaRoute,
  routeId: '506',
  number: '506',
  name: 'Carlaw',
  overnight: false,
  overall: {
    ...slaRoute.overall,
    compliance: 0.96,
    band: 'met',
    latestBand: 'met',
  },
  days: [
    tick('2026-10-10', 0.94),
    tick('2026-10-11', 0.97),
    tick('2026-10-12', 0.96, false),
  ],
  weeks: [tick('2026-10-05', 0.96)],
};

export const slaReportFixture: SlaReportResponse = {
  schemaVersion: 1,
  generatedAt: Date.parse('2026-10-12T14:00:00Z'),
  dataThrough: '2026-10-12',
  targets: {
    versionId: 42,
    toleranceRatio: 1.5,
    metRatio: 0.9,
    degradedRatio: 0.75,
    todayClass: 'weekday',
  },
  overall: {
    compliance: 0.91,
    band: 'met',
    monitoredMinutes: 48_120,
    services: 1_200,
    latestDayKey: '2026-10-12',
    latestBand: 'met',
  },
  routes: [slaRoute, secondRoute],
};

export const slaLiveFixture: SlaLiveBucket[] = [
  {
    endAt: Date.parse('2026-10-12T13:30:00Z'),
    compliance: 0.94,
    band: 'met',
    monitored: true,
  },
  {
    endAt: Date.parse('2026-10-12T13:35:00Z'),
    compliance: 0.88,
    band: 'degraded',
    monitored: true,
  },
  {
    endAt: Date.parse('2026-10-12T13:40:00Z'),
    compliance: null,
    band: 'no-data',
    monitored: false,
  },
];
