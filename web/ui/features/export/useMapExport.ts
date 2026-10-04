import { useRef, useState } from 'react';
import type { Feature, Route, ViewerData } from '../../../../shared/map/model';
import type { SidebarPanel } from '../../commute';
import type { useVehicleFeed } from '../map/useVehicleFeed';
import { exportMap } from './map-export';

interface Options {
  data?: ViewerData;
  shownRoutes: Route[];
  feed: ReturnType<typeof useVehicleFeed>;
  panel: SidebarPanel;
  comparisonStops: { from?: Feature; to?: Feature };
}

export function useMapExport({
  data,
  shownRoutes,
  feed,
  panel,
  comparisonStops,
}: Options) {
  const [exportImage, setExportImage] = useState<string>();
  const [exportCars, setExportCars] = useState(true);
  const capturedMap = useRef<SVGSVGElement | undefined>(undefined);
  const exportDetails = useRef<Parameters<typeof exportMap>[1] | undefined>(undefined);
  function previewMap() {
    const svg = document.querySelector<SVGSVGElement>('#map');
    if (!svg || !data) return;
    capturedMap.current = svg.cloneNode(true) as SVGSVGElement;
    // Preserve the original viewport ratio in the detached frozen copy.
    const box = svg.getBoundingClientRect();
    capturedMap.current.getBoundingClientRect = () => box;
    exportDetails.current = {
      title: 'Toronto streetcar map',
      snapshot: data.snapshot,
      capturedAt: new Date().toISOString(),
      northAngle: data.northAngle,
      routes: shownRoutes.filter((route) => route.scheduled),
      includeCars: exportCars,
      feed: feed.snapshot
        ? 'Vehicle snapshot: ' +
          feed.snapshot.fetchedAt +
          ' · ' +
          feed.snapshot.attribution +
          (feed.failed
            ? ' · Last refresh unavailable'
            : !feed.active
              ? ' · Live feed paused'
              : '')
        : 'No vehicle snapshot loaded.',
      endpoints:
        panel === 'compare'
          ? [
              comparisonStops.from ? 'A: ' + comparisonStops.from.name : '',
              comparisonStops.to ? 'B: ' + comparisonStops.to.name : '',
            ].filter(Boolean)
          : [],
    };
    setExportImage(exportMap(capturedMap.current, exportDetails.current));
  }
  function changeExportCars(includeCars: boolean) {
    setExportCars(includeCars);
    if (capturedMap.current && exportDetails.current)
      setExportImage(
        exportMap(capturedMap.current, { ...exportDetails.current, includeCars }),
      );
  }

  function closeExport() {
    setExportImage(undefined);
    capturedMap.current = undefined;
    exportDetails.current = undefined;
  }
  return { exportImage, exportCars, previewMap, changeExportCars, closeExport };
}
