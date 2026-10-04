import { useId } from 'react';
import type { SidebarPanel } from '../commute';
const panels = ['explore', 'fleet', 'compare', 'stops', 'journal'] as const;
export function SidebarTabs({
  value,
  onChange,
}: {
  value: SidebarPanel;
  onChange(value: SidebarPanel): void;
}) {
  const id = useId();
  return (
    <nav className="sidebar-tabs" aria-label="Map tools">
      <div
        role="tablist"
        aria-label="Map tools"
        onKeyDown={(event) => {
          const focused = panels.findIndex(
            (panel) =>
              event.target instanceof HTMLElement && event.target.id === `${id}-${panel}`,
          );
          const index = focused < 0 ? panels.indexOf(value) : focused;
          const next =
            event.key === 'ArrowRight'
              ? (index + 1) % panels.length
              : event.key === 'ArrowLeft'
                ? (index + panels.length - 1) % panels.length
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? panels.length - 1
                    : undefined;
          if (next !== undefined) {
            event.preventDefault();
            onChange(panels[next]);
            document.getElementById(`${id}-${panels[next]}`)?.focus();
          }
        }}
      >
        {panels.map((panel) => (
          <button
            key={panel}
            id={`${id}-${panel}`}
            role="tab"
            aria-selected={value === panel}
            aria-controls={`panel-${panel}`}
            tabIndex={value === panel ? 0 : -1}
            onClick={() => onChange(panel)}
          >
            {panel === 'explore'
              ? 'Explore'
              : panel === 'fleet'
                ? 'Fleet'
                : panel === 'compare'
                  ? 'Compare'
                  : panel === 'stops'
                    ? 'Stops'
                    : 'Journal'}
          </button>
        ))}
      </div>
    </nav>
  );
}
