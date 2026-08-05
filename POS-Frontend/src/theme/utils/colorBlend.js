export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const channels = (hex) => hex.replace('#', '').match(/\w\w/g).map((part) => parseInt(part, 16));
const hex = (values) => `#${values.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;

export function mix(base, tint, weight) {
  const amount = clamp(weight);
  const [r1, g1, b1] = channels(base);
  const [r2, g2, b2] = channels(tint);
  return hex([r1 + (r2 - r1) * amount, g1 + (g2 - g1) * amount, b1 + (b2 - b1) * amount]);
}

export const lighten = (color, amount) => mix(color, '#ffffff', amount);
export const darken = (color, amount) => mix(color, '#000000', amount);
export const rgba = (color, alpha = 1) => `rgb(${channels(color).join(' ')} / ${clamp(alpha)})`;

export function relativeLuminance(color) {
  const linear = channels(color).map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(first, second) {
  const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

export const isDark = (color) => relativeLuminance(color) < 0.42;

export function ambientTokens(theme, { preserveDefault = false } = {}) {
  if (preserveDefault) return { '--page-gradient': 'none', '--surface-gradient': 'none', '--card-gradient': 'none', '--panel-gradient': 'none', '--dialog-gradient': 'none', '--drawer-gradient': 'none', '--widget-gradient': 'none', '--background-tint': theme.background, '--card-tint': theme.card, '--shadow-color': '0 0 0' };

  const dark = isDark(theme.background);
  const pageTint = dark ? 0.075 : 0.05;
  const cardTint = dark ? 0.07 : 0.06;
  const pageStart = mix(theme.background, theme.primary, pageTint);
  const pageEnd = mix(theme.background, theme.accent, pageTint);
  const cardStart = mix(theme.card, theme.accent, cardTint);
  const surfaceStart = mix(theme.surface, theme.primary, cardTint * 0.72);
  const shadowColor = dark ? mix(theme.primary, '#ffffff', 0.08) : mix(theme.primary, '#000000', 0.10);
  const cardGradient = `linear-gradient(135deg, ${cardStart} 0%, ${theme.card} 58%)`;
  return {
    '--page-gradient': `linear-gradient(135deg, ${pageStart} 0%, ${theme.background} 48%, ${pageEnd} 100%)`,
    '--surface-gradient': `linear-gradient(135deg, ${surfaceStart} 0%, ${theme.surface} 60%)`,
    '--card-gradient': cardGradient,
    '--panel-gradient': cardGradient,
    '--dialog-gradient': `linear-gradient(135deg, ${mix(theme.card, theme.primary, cardTint * 0.8)} 0%, ${theme.card} 62%)`,
    '--drawer-gradient': `linear-gradient(135deg, ${mix(theme.surface, theme.accent, cardTint * 0.65)} 0%, ${theme.surface} 62%)`,
    '--widget-gradient': cardGradient,
    '--background-tint': pageStart,
    '--card-tint': cardStart,
    '--shadow-color': channels(shadowColor).join(' '),
    '--ambient-shadow-opacity': dark ? '0.12' : '0.06',
  };
}
