import { SearchAhead } from './SearchAhead';

export interface RoutesStopsSearchProps {
  value: string;
  label: string;
  placeholder?: string;
  onChange(value: string): void;
  id?: string;
}

/** The shared routes/stops search vocabulary used by list-like features. */
export function RoutesStopsSearch({
  value,
  label,
  placeholder = label,
  onChange,
  id = 'routes-stops-search',
}: RoutesStopsSearchProps) {
  return (
    <SearchAhead
      id={id}
      value={value}
      label={label}
      placeholder={placeholder}
      onChange={onChange}
    />
  );
}
