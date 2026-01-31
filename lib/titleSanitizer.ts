const BASE_MATERIALS = [
  'cotton',
  'polyester',
  'rayon',
  'acrylic',
  'nylon',
  'viscose',
  'modal',
  'spandex',
  'elastane',
  'lycra',
];

const HIGH_VALUE_MATERIALS = [
  'wool',
  'cashmere',
  'silk',
  'linen',
  'leather',
  'suede',
  'down',
  'alpaca',
  'angora',
  'mohair',
];

const FILLER_TOKENS = ['regular', 'casual', 'embroidery'];

const normalize = (value: string): string => String(value || '').toLowerCase();

const looksLikeRedundantSizeAliasToken = (raw: string): boolean => {
  const s = String(raw || '').trim();
  if (!s) return false;
  // Remove standalone alias tokens like "(TG)", "(3XG/3TG)", "TG", "TTG".
  // Keep conversion tokens that include units/regions like EU/UK/US/CM.
  if (/\b(?:EU|UK|US|CM|MM|IN|INCH|INCHES)\b/i.test(s)) return false;

  const inner = s.startsWith('(') && s.endsWith(')') ? s.slice(1, -1) : s;
  const compact = inner.replace(/\s+/g, '').toUpperCase();

  return /^[0-9]*?(?:XG|TG|TTG|TP|P|M|G)(?:\/[0-9]*?(?:XG|TG|TTG|TP|P|M|G))*$/.test(compact);
};

const stripRedundantSizeAliasesFromToken = (raw: string): string => {
  let s = String(raw || '').trim();
  if (!s) return '';

  // Remove trailing parenthetical alias blocks like "3XL (3XG/3TG)" or "XL(TG)".
  s = s.replace(/\s*\(([^)]+)\)\s*$/g, (_m, inner) => {
    const v = String(inner || '').trim();
    if (!v) return '';
    if (/\b(?:EU|UK|US|CM|MM|IN|INCH|INCHES)\b/i.test(v)) return ` (${v})`;
    return looksLikeRedundantSizeAliasToken(`(${v})`) ? '' : ` (${v})`;
  });

  // Remove trailing "/TG"-style aliases when redundant.
  s = s.replace(/\s*\/?\s*(?:TP|TTG|TG|XG|G)\s*$/i, (m) => {
    const before = s.slice(0, Math.max(0, s.length - m.length)).trim();
    return before ? '' : m;
  });

  return s.trim();
};

const hasDetected = (materials: string[], target: string): boolean => {
  const t = normalize(target);
  return materials.some((m) => normalize(m).includes(t));
};

export function sanitizeTitleTokens(tokens: string[], detectedMaterials: string[]): string[] {
  const cleaned: string[] = [];
  const detected = Array.isArray(detectedMaterials) ? detectedMaterials : [];

  for (const token of tokens || []) {
    const raw = stripRedundantSizeAliasesFromToken(String(token || '').trim());
    if (!raw) continue;
    if (looksLikeRedundantSizeAliasToken(raw)) continue;
    const lower = normalize(raw);
    if (FILLER_TOKENS.includes(lower)) continue;
    if (/%/.test(raw) || /\d+\s*%/.test(raw)) continue;
    if (lower.includes('blend')) continue;

    const isBaseMaterial = BASE_MATERIALS.some((m) => lower.includes(m));
    if (isBaseMaterial) continue;

    const isHighValue = HIGH_VALUE_MATERIALS.some((m) => lower.includes(m));
    if (isHighValue && !hasDetected(detected, raw)) continue;

    cleaned.push(raw);
  }

  const hasStretchSignal = ['spandex', 'elastane', 'lycra'].some((m) => hasDetected(detected, m));
  const alreadyHasStretch = cleaned.some((t) => normalize(t) === 'stretch');
  if (hasStretchSignal && !alreadyHasStretch) {
    cleaned.push('Stretch');
  }

  // Example:
  // sanitizeTitleTokens(['100% Cotton', 'Wool', 'Blend', 'Jacket'], ['Wool']) => ['Jacket', 'Wool']

  return cleaned;
}
