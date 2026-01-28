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

const hasDetected = (materials: string[], target: string): boolean => {
  const t = normalize(target);
  return materials.some((m) => normalize(m).includes(t));
};

export function sanitizeTitleTokens(tokens: string[], detectedMaterials: string[]): string[] {
  const cleaned: string[] = [];
  const detected = Array.isArray(detectedMaterials) ? detectedMaterials : [];

  for (const token of tokens || []) {
    const raw = String(token || '').trim();
    if (!raw) continue;
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
