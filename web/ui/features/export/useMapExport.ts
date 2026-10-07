import { t } from '../../i18n';
import { useRef, useState } from 'react';
import type { Route, ViewerData } from '../../../../shared/map/model';
import type { useVehicleFeed } from '../map/useVehicleFeed';
import { exportMap } from './map-export';

interface Options {
  data?: ViewerData;
  shownRoutes: Route[];
  feed: ReturnType<typeof useVehicleFeed>;
}

export function useMapExport({ data, shownRoutes, feed }: Options) {
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
      title: t('useMapExport.torontoStreetcarMap'),
      snapshot: data.snapshot,
      capturedAt: new Date().toISOString(),
      northAngle: data.northAngle,
      routes: shownRoutes.filter((route) => route.scheduled),
      includeCars: exportCars,
      feed: feed.snapshot
        ? t('useMapExport.vehicleSnapshot') +
          feed.snapshot.fetchedAt +
          ' · ' +
          feed.snapshot.attribution +
          (feed.failed
            ? t('useMapExport.lastRefreshUnavailable')
            : !feed.active
              ? t('useMapExport.liveFeedPaused')
              : '')
        : t('useMapExport.noVehicleSnapshotLoaded'),
      endpoints: [],
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
