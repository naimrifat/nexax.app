// src/components/SpecificsEditor.tsx
import React from 'react';
import type { ItemSpecific } from '../types';

type Props = {
  specifics: ItemSpecific[];
  onChange: (idx: number, val: string | string[]) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
  loading?: boolean;
};

export function SpecificsEditor({
  specifics,
  onChange,
  onRemove,
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
          const options = Array.isArray(spec.options) ? spec.options : [];
          const hasOptions = options.length > 0;
          const isSelect = (spec.selectionOnly || hasOptions) && hasOptions;

          // Consider field multi if schema says so OR value is an array already
          const isMulti = !!spec.multi || Array.isArray(spec.value);

          // Helpers for rendering values consistently
          const singleValue =
            Array.isArray(spec.value) ? String(spec.value[0] ?? '') : String(spec.value ?? '');

          const multiValues: string[] = Array.isArray(spec.value)
            ? spec.value
            : spec.value
            ? [String(spec.value)]
            : [];

          return (
            <div
              key={`${spec.name || 'custom'}-${idx}`}
              className="grid grid-cols-1 md:grid-cols-7 gap-3 items-start"
            >
              {/* Name / Meta */}
              <div className="md:col-span-2">
                <div className="text-sm font-medium text-gray-900 break-words">
                  {spec.name || <span className="italic text-gray-500">Custom Specific</span>}
                  {spec.required ? <span className="text-red-500 ml-1">*</span> : null}
                </div>
                <div className="text-xs text-gray-500 mt-1 space-x-2">
                  {isMulti && <span className="inline-block">Multi</span>}
                  {spec.selectionOnly && <span className="inline-block">Options only</span>}
                  {spec.freeTextAllowed && <span className="inline-block">Free text allowed</span>}
                </div>
              </div>

              {/* Value control */}
              <div className="md:col-span-4">
                {isSelect ? (
                  isMulti ? (
                    // MULTI-SELECT with allowed options
                    <>
                      <select
                        multiple
                        className="w-full min-h-[2.5rem] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                        value={multiValues}
                        onChange={(e) => {
                          const values = Array.from(e.target.selectedOptions).map((o) => o.value);
                          onChange(idx, values); // string[]
                        }}
                      >
                        {options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>

                      {/* Selected "chips" for clarity */}
                      {multiValues.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
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
                                title={`Remove ${v}`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    // SINGLE-SELECT with allowed options
                    <select
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                      value={singleValue}
                      onChange={(e) => onChange(idx, e.target.value)}
                    >
                      <option value="">Select…</option>
                      {options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  )
                ) : // Free-text path (no options in schema)
                isMulti ? (
                  // MULTI free-text as a simple tag editor
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
                            title={`Remove ${v}`}
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
                          if (!multiValues.includes(val)) onChange(idx, [...multiValues, val]);
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

              {/* Remove button */}
              <div className="md:col-span-1 flex md:justify-end">
                <button
                  type="button"
                  onClick={() => onRemove(idx)}
                  className="text-sm text-red-600 hover:text-red-700 font-medium"
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
