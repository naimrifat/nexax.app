import React, { useEffect, useRef, useState } from 'react';
import type { ItemSpecific } from '../types';

type Props = {
  specifics: ItemSpecific[];
  onChange: (idx: number, val: string | string[]) => void;
  onRemove: (idx: number) => void; // still here in case you use it for custom fields
  onAdd: () => void;
  loading?: boolean;
};

type MultiSelectProps = {
  value: string[];
  options: string[];
  onChange: (val: string[]) => void;
  freeTextAllowed?: boolean;
};

const MultiSelect: React.FC<MultiSelectProps> = ({
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

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === 'Enter' && freeTextAllowed) {
      e.preventDefault();
      addValue(input);
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      // Backspace with empty input removes last chip
      onChange(value.slice(0, -1));
    }
  };

  const filteredOptions = options.filter((opt) =>
    opt.toLowerCase().includes(input.toLowerCase())
  );

  return (
    <div className="relative" ref={containerRef}>
      {/* Chip box + input */}
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
          className="flex-1 min-w-[60px] border-none outline-none text-sm py-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
        />
      </div>

      {/* Dropdown list (only when open) */}
      {open && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-lg">
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              {freeTextAllowed
                ? 'Type and press Enter to add a custom value.'
                : 'No matching options.'}
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

export function SpecificsEditor({
  specifics,
  onChange,
  onRemove, // currently unused visually, but kept for API compatibility
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
        {specifics.map((spec, idx) => {
          const options = Array.isArray((spec as any).options)
            ? ((spec as any).options as string[])
            : [];
          const hasOptions = options.length > 0;
          const isSelect = (spec.selectionOnly || hasOptions) && hasOptions;
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
              key={`${spec.name || 'custom'}-${idx}`}
              className="grid grid-cols-1 md:grid-cols-6 gap-3 items-start"
            >
              {/* Name */}
              <div className="md:col-span-2">
                <div className="text-sm font-medium text-gray-900 break-words">
                  {spec.name || (
                    <span className="italic text-gray-500">Custom Specific</span>
                  )}
                  {spec.required ? (
                    <span className="text-red-500 ml-1">*</span>
                  ) : null}
                </div>
              </div>

              {/* Value control */}
              <div className="md:col-span-4">
                {isSelect ? (
                  isMulti ? (
                    // MULTI + OPTIONS: chip + dropdown UI
                    <MultiSelect
                      value={multiValues}
                      options={options}
                      onChange={(vals) => onChange(idx, vals)}
                      freeTextAllowed={spec.freeTextAllowed}
                    />
                  ) : (
                    // SINGLE-SELECT
                    <select
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                      value={singleValue}
                      onChange={(e) => onChange(idx, e.target.value)}
                    >
                      <option value="">Select...</option>
                      {options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  )
                ) : // No options from schema — free-text path
                isMulti ? (
                  // MULTI free-text only (no options)
                  <div>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {multiValues.map((v) => (
                        <span
                          key={v}
                          className="inline-flex items-center rounded-full border px-2 py-1 text-xs bg-gray-50"
                        >
                          {v}
                          <button
                            type="button"
                            className="ml-2 text-gray-500 hover:text-gray-700"
                            onClick={() =>
                              onChange(
                                idx,
                                multiValues.filter((x) => x !== v)
                              )
                            }
                            aria-label={`Remove ${v}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <input
                      type="text"
                      placeholder="Add value and press Enter"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = (e.currentTarget.value || '').trim();
                          if (!val) return;
                          if (!multiValues.includes(val)) {
                            onChange(idx, [...multiValues, val]);
                          }
                          e.currentTarget.value = '';
                        }
                      }}
                    />
                  </div>
                ) : (
                  // SINGLE free-text
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                    value={singleValue}
                    onChange={(e) => onChange(idx, e.target.value)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
