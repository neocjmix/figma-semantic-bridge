import { useEffect, useRef, useState } from 'react';

/** Preserve an unfinished sign or decimal while the canvas keeps its last valid coordinate. */
export function CoordinateInput({ value, onChange, label, disabled }: {
  value: number;
  onChange(value: number): void;
  label: string;
  disabled: boolean;
}) {
  const [text, setText] = useState(String(value));
  const published = useRef(value);
  useEffect(() => {
    // Echoes of typing must not erase a trailing decimal. Canvas moves and other
    // external changes should still replace the field's displayed coordinate.
    if (!Object.is(value, published.current)) setText(String(value));
    published.current = value;
  }, [value]);

  return <input type="text" inputMode="decimal" disabled={disabled} aria-label={label}
    value={text} onChange={event => {
      const next = event.target.value;
      setText(next);
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(next)) return;
      const number = Number(next);
      if (!Number.isFinite(number)) return;
      published.current = number;
      onChange(number);
    }} onBlur={() => setText(String(value))} />;
}
