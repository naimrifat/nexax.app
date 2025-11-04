import React, { useMemo } from 'react';

export type ItemSpecific = {
  name: string;
  value?: string | string[];
  options: string[];
  required?: boolean;
  multi?: boolean;
  selectionOnly?: boolean;
  freeTextAllowed?: boolean;
};

type Props = {
  spec: ItemSpecific;
  onChange: (newValue: string | string[]) => void;
};

const ItemSpecificRow = React.memo(function ItemSpecificRow({ spec, onChange }: Props) {
  const { name, required, options, multi, selectionOnly, freeTextAllowed } = spec;

  // Normalize current value
  const current = useMemo(() => {
    if (multi) {
      return Array.isArray(spec.value) ? spec.value : (spec.value ? [String(spec.value)] : []);
    }
    return typeof spec.value === 'string' ? spec.value : '';
  }, [spec.value, multi]);

  const stableOptions = useMemo(() => options || [], [options]);

  const toggleMulti = (val: string) => {
    const set = new Set(current as string[]);
    if (set.has(val)) set.delete(val);
    else set.add(val);
    onChange(Array.from(set));
  };

  return (
    <div className="grid grid-cols-2 gap-2 mb-2">
      {/* Label */}
      <label className="px-3 py-2 border border-gray-300 rounded-md bg-gray-50 flex items-center">
        <span className="truncate">
          {name}{required ? <span className="text-red-500 ml-1">*</span> : null}
        </span>
      </label>

      {/* Control */}
      <div className="flex items-center">
        {/* MULTI-SELECT */}
        {multi ? (
          <div className="w-full">
            <div className="flex flex-wrap gap-1 mb-1">
              {(current as string[]).map((chip) => (
                <span
                  key={chip}
                  className="inline-flex items-center px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 text-xs"
                >
                  {chip}
                  <button
                    type="button"
                    className="ml-1 text-teal-700 hover:text-teal-900"
                    onClick={() => toggleMulti(chip)}
                    aria-label={`Remove ${chip}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>

            {/* Dropdown of options to add/remove */}
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              value=""
              onChange={(e) => {
                const val = e.target.value;
                if (val) toggleMulti(val);
              }}
            >
              <option value="">Add…</option>
              {stableOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>

            {/* free text chip adder */}
            {freeTextAllowed && (
              <input
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Type and press Enter to add custom value"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = (e.currentTarget.value || '').trim();
                    if (val) {
                      toggleMulti(val);
                      e.currentTarget.value = '';
                    }
                  }
                }}
              />
            )}
          </div>
        ) : (
          // SINGLE SELECT or TEXT
          <>
            {!selectionOnly ? (
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                value={current as string}
                onChange={(e) => onChange(e.target.value)}
                list={`datalist-${name}`}
              />
            ) : (
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                value={(current as string) || ''}
                onChange={(e) => onChange(e.target.value)}
              >
                <option value="">{required ? 'Select… *' : 'Select…'}</option>
                {stableOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}

            {/* Optional datalist to assist free text with options */}
            {!selectionOnly && stableOptions.length > 0 && (
              <datalist id={`datalist-${name}`}>
                {stableOptions.slice(0, 150).map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
            )}
          </>
        )}
      </div>
    </div>
  );
});

export default ItemSpecificRow;
