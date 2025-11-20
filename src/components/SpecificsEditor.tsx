import React from 'react';
import { ItemSpecific } from '../types';
import { filterSizeOptionsBySizeType, isSizeAspectName, getSizeTypeValue } from '../lib/listing-logic';

interface Props {
  specifics: ItemSpecific[];
  onChange: (index: number, newValue: string | string[]) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  loading?: boolean;
}

export function SpecificsEditor({ specifics, onChange, onRemove, onAdd, loading }: Props) {
  
  // Helper to get filtered options for a specific row
  const getOptionsForSpec = (spec: ItemSpecific) => {
    const rawOptions = spec.options || [];
    
    // Apply Size Type filter logic if applicable
    if (isSizeAspectName(spec.name)) {
      const currentSizeType = getSizeTypeValue(specifics);
      return filterSizeOptionsBySizeType(currentSizeType, rawOptions);
    }
    
    return rawOptions;
  };

  return (
    <section className="card p-6 bg-white shadow rounded-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          Item Specifics
          {loading && <span className="ml-2 text-sm text-teal-600 animate-pulse">Syncing...</span>}
        </h3>
      </div>

      <div className="space-y-4">
        {specifics.map((spec, idx) => {
          const effectiveOptions = getOptionsForSpec(spec);
          // Determine if we should show a Select or Input
          const isSelect = (spec.selectionOnly || effectiveOptions.length > 0) && effectiveOptions.length > 0;

          return (
            <div key={`${spec.name}-${idx}`} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center border-b border-gray-50 pb-4 last:border-0">
              {/* Label */}
              <div className="md:col-span-4 flex items-center text-sm font-medium text-gray-700">
                 <span>{spec.name || 'Custom Aspect'}</span>
                 {spec.required && <span className="text-red-500 ml-1" title="Required">*</span>}
              </div>

              {/* Input Area */}
              <div className="md:col-span-8 flex gap-2 items-center">
                {isSelect ? (
                  <select
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
                    value={Array.isArray(spec.value) ? spec.value[0] : spec.value}
                    onChange={(e) => onChange(idx, e.target.value)}
                  >
                    <option value="">Select...</option>
                    {effectiveOptions.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
                    value={Array.isArray(spec.value) ? spec.value.join(', ') : spec.value}
                    onChange={(e) => onChange(idx, e.target.value)}
                    placeholder="Enter value..."
                  />
                )}
                
                {/* Remove Button (only for non-required fields) */}
                {!spec.required && (
                   <button 
                     onClick={() => onRemove(idx)} 
                     className="text-gray-400 hover:text-red-500 p-1 rounded hover:bg-red-50 transition-colors"
                     title="Remove field"
                   >
                     ✕
                   </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={onAdd}
        className="mt-4 text-sm text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1"
      >
        + Add Custom Field
      </button>
    </section>
  );
}
