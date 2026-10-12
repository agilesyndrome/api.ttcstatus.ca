import type { ReactNode } from 'react';

export interface SegmentedControlOption<Value extends string> {
  value: Value;
  label: ReactNode;
}

export function SegmentedControl<Value extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: Value;
  options: readonly SegmentedControlOption<Value>[];
  label: string;
  onChange(value: Value): void;
}) {
  return (
    <div className="segmented-control" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
