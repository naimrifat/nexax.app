import React, { useEffect, useRef, useState } from 'react';
import type { ItemSpecific } from '../types';

type Props = {
  specifics: ItemSpecific[];
  onChange: (idx: number, val: string | string[]) => void;
  onRemove: (idx: number) => void; // kept for API compatibility (not shown in UI)
  onAdd: () => void;
  loading?: boolean;
};

type MultiSelectProps = {
  value: string[];
  options: string[];
  onChange: (val: string[]) => void;
  freeTextAllowed?: boolean;
};

/**
 * MultiSelect: chip-style multi select with dropdown on click
 */
const MultiSelectComponent: React.FC<MultiSelectProps> = ({
  value,
  options,
  onChange,
  freeTextAllowed,
}) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const addValue = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setInput('');
  };

  const removeValue = (val: string) => {
    onChange(value.filter((v) => v !== val));
  };

  const filteredOptions = options.filter((opt) =>
    opt.toLowerCase().includes(input.toLowerCase())
  );

  return (
    <div className="relative" ref={containerRef}>
      {/* Chip container */}
      <div
        className="flex flex-wrap items-center gap-1 px-2 py-1 border border-gray-300 rounded-md bg-white cursor-text focus-within:ring-2 focus-within:ring-teal-500"
        onClick={() => setOpen(true)}
      >
        {value.map((v) => (
          <span
            key={v}
            className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-gray-50"
          >
            {v}
            <button
              type="button"
              className="ml-1 text-gray-500 hover:text-gray-700"
              onClick={(e) => {
                e.stopPropagation();
                removeValue(v);
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[40px] border-none outline-none text-sm py-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && freeTextAllowed) {
              e.preventDefault();
              addValue(input);
            }
          }}
        />
      </div>

      {/* Dropdown options */}
      {open && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-lg">
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              {freeTextAllowed
                ? 'Press Enter to add a custom value'
                : 'No matching options'}
            </div>
          ) : (
            filteredOptions.map((opt) => (
              <button
                type="button"
                key={opt}
                className="w-full text-left px-3 py-2 text-sm hover:bg-teal-50"
                onClick={() => addValue(opt)}
              >
                {opt}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const MultiSelect = React.memo(MultiSelectComponent);

type RowProps = {
  spec: ItemSpecific;
  index: number;
  onChangeRow: (idx: number, val: string | string[]) => void;
};

/**
 * One row for an item specific — memoized so only this row re-renders when it changes
 */
const ItemSpecificRowComponent: React.FC<RowProps> = ({
  spec,
  index,
  onChangeRow,
}) => {
  const options = Array.isArray((spec as any).options)
    ? ((spec as any).options as string[])
    : [];
  const hasOptions = options.length > 0;
  const isMulti = !!spec.multi || Array.isArray(spec.value);

  const singleValue = Array.isArray(spec.value)
    ? String(spec.value[0] ?? '')
    : String(spec.value ?? '');

  const multiValues: string[] = Array.isArray(spec.value)
    ? spec.value
    : spec.value
    ? [String(spec.value)]
    : [];

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-6 gap-3 items-start"
      key={`${spec.name || 'custom'}-${index}`}
    >
      {/* Name */}
      <div className="md:col-span-2 text-sm font-medium text-gray-900 break-words">
        {spec.name || (
          <span className="italic text-gray-500">Custom Specific</span>
        )}
        {spec.required && <span className="text-red-500 ml-1">*</span>}
      </div>

      {/* Value control */}
      <div className="md:col-span-4">
        {hasOptions ? (
          isMulti ? (
            <MultiSelect
              value={multiValues}
              options={options}
              freeTextAllowed={spec.freeTextAllowed}
              onChange={(vals) => onChangeRow(index, vals)}
            />
          ) : (
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={singleValue}
              onChange={(e) => onChangeRow(index, e.target.value)}
            >
              <option value="">Select...</option>
              {options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )
        ) : isMulti ? (
          <MultiSelect
            value={multiValues}
            options={[]}
            freeTextAllowed={spec.freeTextAllowed}
            onChange={(vals) => onChangeRow(index, vals)}
          />
        ) : (
          <input
            type="text"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
            value={singleValue}
            onChange={(e) => onChangeRow(index, e.target.value)}
          />
        )}
      </div>
    </div>
  );
};

const ItemSpecificRow = React.memo(ItemSpecificRowComponent);

/**
 * Main SpecificsEditor — memoized to avoid unnecessary re-renders
 */
function SpecificsEditorComponent({
  specifics,
  onChange,
  onRemove, // currently unused in UI, kept for API compatibility
  onAdd,
  loading,
}: Props) {
  return (
    <section className="card p-6 bg-white shadow rounded-lg space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">Item Specifics</h3>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-white font-medium hover:bg-teal-700"
        >
          + Add Specific
        </button>
      </div>

      {loading && (
        <div className="text-sm text-gray-500">Loading category schema…</div>
      )}

      <div className="space-y-6">
        {specifics.map((spec, idx) => (
          <ItemSpecificRow
            key={`${spec.name || 'custom'}-${idx}`}
            spec={spec}
            index={idx}
            onChangeRow={onChange}
          />
        ))}
      </div>
    </section>
  );
}

export const SpecificsEditor = React.memo(SpecificsEditorComponent);
