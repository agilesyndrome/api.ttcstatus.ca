import type { ChangeEvent } from 'react';

export interface SearchAheadProps {
  id: string;
  value: string;
  label: string;
  placeholder?: string;
  onChange(value: string): void;
  className?: string;
}

/** Controlled, instant search input for lists that narrow as the user types. */
export function SearchAhead({
  id,
  value,
  label,
  placeholder,
  onChange,
  className,
}: SearchAheadProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
  };
  return (
    <div className={['search-ahead', className].filter(Boolean).join(' ')}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="search-ahead__input"
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
      />
    </div>
  );
}
