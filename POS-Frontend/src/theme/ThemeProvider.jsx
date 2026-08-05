import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_THEME, THEMES } from './themes';
import { ambientTokens, contrastRatio, isDark } from './utils/colorBlend';

export const ThemeContext = createContext(null);
const KEY = 'pos.theme';
const rgb = (hex) => hex.match(/\w\w/g).map((x) => parseInt(x, 16)).join(' ');
const contrastText = (hex) => {
  const [r, g, b] = hex.match(/\w\w/g).map((x) => parseInt(x, 16) / 255);
  const linear = (value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminance > 0.36 ? '15 23 42' : '255 255 255';
};

function applyTheme(id) {
  const theme = THEMES[id] || THEMES[DEFAULT_THEME];
  const dark = Boolean(theme.dark) || isDark(theme.background);
  const isDefault = id === DEFAULT_THEME;
  const values = {
    '--ground': rgb(theme.background), '--surface': rgb(theme.card), '--raised': rgb(theme.input),
    '--hair': rgb(theme.border), '--hairsoft': dark ? rgb(theme.border) : '226 232 240',
    '--bone': dark ? '245 239 230' : '15 23 42', '--dim': dark ? '166 156 140' : '51 65 85',
    '--mute': dark ? '110 101 90' : '100 116 139', '--primary': rgb(theme.primary), '--secondary': rgb(theme.secondary),
    '--accent': rgb(theme.accent), '--sidebar': rgb(theme.sidebar), '--success': rgb(theme.success), '--warning': rgb(theme.warning),
    '--danger': rgb(theme.danger), '--info': rgb(theme.info),
    '--inverse': '255 255 255', '--overlay': '0 0 0', '--receipt': dark ? '255 255 255' : rgb(theme.surface),
    '--receipt-text': dark ? '17 17 17' : '15 23 42', '--receipt-border': dark ? '107 114 128' : '148 163 184',
    '--receipt-frame': dark ? '229 231 235' : '226 232 240',
    '--chart1': rgb(theme.chartPalette[0]), '--chart2': rgb(theme.chartPalette[1]), '--chart3': rgb(theme.chartPalette[2]),
    '--chart4': rgb(theme.chartPalette[3]), '--chart5': rgb(theme.chartPalette[4]),
    '--login': dark ? '15 13 11' : rgb(theme.sidebar), '--on-primary': dark ? '26 18 6' : '255 255 255',
    '--header': rgb(theme.header), '--table-header': rgb(theme.tableHeader),
    '--sidebar-border': isDefault ? '46 42 36' : rgb(theme.primary), '--sidebar-hover': isDefault ? rgb(theme.sidebar) : rgb(theme.secondary),
    '--sidebar-active': isDefault ? '35 32 25' : rgb(theme.primary), '--sidebar-text': isDefault ? '110 101 90' : contrastText(theme.sidebar),
    '--sidebar-text-muted': isDefault ? '110 101 90' : contrastText(theme.sidebar), '--sidebar-text-hover': isDefault ? '166 156 140' : contrastText(theme.sidebar),
    '--sidebar-text-active': isDefault ? rgb(theme.primary) : contrastText(theme.primary), '--sidebar-icon': isDefault ? '110 101 90' : contrastText(theme.sidebar),
    '--sidebar-icon-hover': isDefault ? '166 156 140' : contrastText(theme.sidebar), '--sidebar-icon-active': isDefault ? rgb(theme.primary) : contrastText(theme.primary),
    '--sidebar-active-border': isDefault ? rgb(theme.primary) : rgb(theme.accent), '--sidebar-logo': isDefault ? rgb(theme.primary) : rgb(theme.accent), '--sidebar-logo-text': isDefault ? '26 18 6' : contrastText(theme.accent),
    '--header-text': dark ? '241 245 249' : '15 23 42', '--header-muted': dark ? '148 163 184' : '100 116 139',
    '--avatar': isDefault ? rgb(theme.secondary) : rgb(theme.primary), '--avatar-text': isDefault ? rgb(theme.primary) : contrastText(theme.primary), '--avatar-border': rgb(theme.border),
    '--profile-name': isDefault || dark ? '245 239 230' : '15 23 42', '--profile-role': isDefault ? '110 101 90' : (dark ? '148 163 184' : '100 116 139'), '--profile-code': rgb(theme.primary),
    '--shadow-card': isDefault ? 'none' : (dark ? '0 12px 28px rgb(0 0 0 / 0.24)' : '0 8px 24px rgb(15 23 42 / 0.08)'),
    '--shadow-dialog': dark ? '0 24px 64px rgb(0 0 0 / 0.48)' : '0 24px 64px rgb(15 23 42 / 0.18)',
    '--shadow-sidebar': isDefault ? 'none' : (dark ? '8px 0 28px rgb(0 0 0 / 0.22)' : '8px 0 28px rgb(15 23 42 / 0.10)'),
    '--shadow-header': isDefault ? 'none' : (dark ? '0 6px 18px rgb(0 0 0 / 0.18)' : '0 4px 16px rgb(15 23 42 / 0.05)'),
    '--shadow-active': isDefault ? 'none' : (dark ? '0 6px 16px rgb(0 0 0 / 0.22)' : '0 6px 16px rgb(15 23 42 / 0.16)'),
    '--app-glow-one': rgb(theme.accent), '--app-glow-two': rgb(theme.primary), '--app-glow-opacity': '0',
    '--header-gradient-start': isDefault ? rgb(theme.header) : (dark ? rgb(theme.sidebar) : rgb(theme.header)),
    '--header-gradient-end': isDefault ? rgb(theme.header) : (dark ? rgb(theme.card) : rgb(theme.header)),
    '--header-glow-one': rgb(theme.primary), '--header-glow-two': rgb(theme.accent), '--header-glow-opacity': isDefault ? '0' : (dark ? '0.16' : '0.09'),
    ...ambientTokens(theme, { preserveDefault: isDefault }),
  };
  Object.entries(values).forEach(([key, value]) => document.documentElement.style.setProperty(key, value));
  document.documentElement.dataset.theme = id;
  // Kept available for development diagnostics without affecting rendering.
  document.documentElement.dataset.themeContrast = contrastRatio(theme.background, dark ? '#f1f5f9' : '#0f172a').toFixed(2);
}

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => {
    const saved = localStorage.getItem(KEY);
    const initial = THEMES[saved] ? saved : DEFAULT_THEME;
    applyTheme(initial);
    return initial;
  });
  useEffect(() => applyTheme(themeId), [themeId]);
  const selectTheme = useCallback((id) => { const next = THEMES[id] ? id : DEFAULT_THEME; setThemeId(next); localStorage.setItem(KEY, next); }, []);
  const value = useMemo(() => ({ themeId, themes: THEMES, selectTheme }), [themeId, selectTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
