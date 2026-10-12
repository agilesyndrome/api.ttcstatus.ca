import type { DebugMapBundle } from './debug-types';
import { escapeXml } from './svg';

export function layoutLabels(bundle: DebugMapBundle): string {
  const occupied: { x: number; y: number; w: number; h: number }[] = [];
  const labels = [...(bundle.context?.labels ?? [])].sort(
    (a, b) => Number(b.kind === 'terminal') - Number(a.kind === 'terminal'),
  );
  return labels
    .map((label) => {
      let [x, y] = label.point;
      const terminal = label.kind === 'terminal';
      // Prefer actual feed stop positions over approximate context anchors.
      const stops = terminal
        ? (bundle.stops ?? []).filter(
            (s) =>
              (s.name ?? '').toLowerCase().includes(label.text.toLowerCase()) &&
              /loop|station/i.test(s.name ?? ''),
          )
        : [];
      const nearest = stops.sort(
        (a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y),
      )[0];
      if (nearest) {
        x = nearest.x;
        y = nearest.y;
      }
      const marker = terminal
        ? `<circle cx="${x}" cy="${y}" r="5" fill="#fffdf7" stroke="#25343c" stroke-width="2"/>`
        : '';
      const w = label.text.length * (terminal ? 7.7 : 7) + 12,
        h = terminal ? 22 : 20;
      const vertical = Math.abs(label.angle) === 90;
      const bw = vertical ? h : w,
        bh = vertical ? w : h;
      const offsets = terminal
        ? [
            [9, -29],
            [9, 9],
            [-w - 9, -29],
            [-w - 9, 9],
            [9, -52],
            [9, 32],
          ]
        : vertical
          ? [
              [10, -bh / 2],
              [-bw - 10, -bh / 2],
              [28, -bh / 2],
              [-bw - 28, -bh / 2],
            ]
          : [
              [-bw / 2, -bh - 10],
              [-bw / 2, 10],
              [-bw / 2, -bh - 28],
              [-bw / 2, 28],
              [10, -bh / 2],
              [-bw - 10, -bh / 2],
            ];
      for (const [dx, dy] of offsets) {
        const box = { x: x + dx, y: y + dy, w: bw, h: bh };
        if (
          box.x < 15 ||
          box.y < 100 ||
          box.x + bw > bundle.display.width - 15 ||
          box.y + bh > bundle.display.height - 145
        )
          continue;
        if (
          occupied.some(
            (p) =>
              box.x < p.x + p.w + 5 &&
              box.x + bw + 5 > p.x &&
              box.y < p.y + p.h + 5 &&
              box.y + bh + 5 > p.y,
          )
        )
          continue;
        occupied.push(box);
        const cx = box.x + bw / 2,
          cy = box.y + bh / 2;
        const leader = terminal
          ? `<line x1="${x}" y1="${y}" x2="${Math.max(box.x, Math.min(x, box.x + bw))}" y2="${Math.max(box.y, Math.min(y, box.y + bh))}" stroke="#7e8c91" stroke-width="0.9"/>`
          : '';
        return `${leader}${marker}<g transform="translate(${cx} ${cy}) rotate(${label.angle})"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="4" fill="#fffdf7" opacity="0.94"/><text text-anchor="middle" dominant-baseline="central" font-size="${terminal ? 14 : 13}" font-weight="${terminal ? 650 : 500}" fill="${terminal ? '#25343c' : '#5b6870'}">${escapeXml(label.text)}</text></g>`;
      }
      return marker;
    })
    .join('');
}
