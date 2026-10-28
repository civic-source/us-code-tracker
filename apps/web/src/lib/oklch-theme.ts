import { CURATED_OKLCH_THEMES, type OklchThemePreset } from '../data/oklch-presets';

export const OKLCH_THEME_STORAGE_KEY = 'oklch-reading-theme';

export function getCuratedTheme(slug: string): OklchThemePreset | undefined {
  return CURATED_OKLCH_THEMES.find((t) => t.slug === slug);
}

const OKLCH_PROPERTIES = [
  '--surface-canvas',
  '--surface-raised',
  '--surface-sunken',
  '--surface-overlay',
  '--border-default',
  '--border-subtle',
  '--border-strong',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--civic-navy',
  '--civic-navy-dark',
  '--civic-action',
  '--legal-valid',
  '--legal-caution',
  '--legal-invalid',
  '--diff-add-text',
  '--diff-del-text',
] as const;

/**
 * Applies an OKLCH terminal theme to the document.
 * If null, clears overrides to restore standard USWDS Light/Dark theme.
 */
export function applyOklchTheme(theme: OklchThemePreset | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (!theme) {
    // Clear all inline overrides
    for (const prop of OKLCH_PROPERTIES) {
      root.style.removeProperty(prop);
    }
    root.removeAttribute('data-oklch-theme');
    try {
      localStorage.removeItem(OKLCH_THEME_STORAGE_KEY);
      // Re-apply standard theme (stored or media preference)
      const standardTheme = localStorage.getItem('theme');
      if (standardTheme === 'dark' || (!standardTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    } catch {
      // Storage access blocked or restricted
    }
    return;
  }

  // Set dark/light class to match theme luminance
  if (theme.isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  root.setAttribute('data-oklch-theme', theme.slug);

  const colors = theme.colors;
  const bg = colors.background;
  const fg = colors.foreground;
  const selection = colors.selection || (theme.isDark ? 'oklch(0.32 0.03 240)' : 'oklch(0.92 0.02 90)');
  const black = colors.black || (theme.isDark ? 'oklch(0.20 0.02 240)' : 'oklch(0.95 0.01 90)');
  const brightBlack = colors.brightBlack || black;
  const green = colors.brightGreen || colors.green || 'oklch(0.70 0.15 140)';
  const red = colors.brightRed || colors.red || 'oklch(0.65 0.20 25)';
  const yellow = colors.brightYellow || colors.yellow || 'oklch(0.75 0.15 85)';
  const blue = colors.brightBlue || colors.blue || 'oklch(0.65 0.12 250)';
  const cyan = colors.brightCyan || colors.cyan || blue;

  // Surface tokens
  root.style.setProperty('--surface-canvas', bg);
  root.style.setProperty('--surface-raised', selection);
  root.style.setProperty('--surface-sunken', black);
  root.style.setProperty('--surface-overlay', selection);

  // Border tokens
  root.style.setProperty('--border-default', brightBlack);
  root.style.setProperty('--border-subtle', black);
  root.style.setProperty('--border-strong', fg);

  // Text tokens
  root.style.setProperty('--text-primary', fg);
  root.style.setProperty('--text-secondary', blue);
  root.style.setProperty('--text-muted', brightBlack);

  // Brand & Action
  root.style.setProperty('--civic-navy', blue);
  root.style.setProperty('--civic-navy-dark', fg);
  root.style.setProperty('--civic-action', cyan);

  // Legal signals
  root.style.setProperty('--legal-valid', green);
  root.style.setProperty('--legal-caution', yellow);
  root.style.setProperty('--legal-invalid', red);

  // Diff tokens
  root.style.setProperty('--diff-add-text', green);
  root.style.setProperty('--diff-del-text', red);

  try {
    localStorage.setItem(OKLCH_THEME_STORAGE_KEY, theme.slug);
  } catch {
    // Storage access blocked or restricted
  }
}

/**
 * Initializes the stored OKLCH theme on page load.
 */
export function initOklchTheme(): void {
  if (typeof window === 'undefined') return;
  try {
    const saved = localStorage.getItem(OKLCH_THEME_STORAGE_KEY);
    if (!saved) return;
    const found = getCuratedTheme(saved);
    if (found) {
      applyOklchTheme(found);
    }
  } catch {
    // Storage access blocked or restricted
  }
}
