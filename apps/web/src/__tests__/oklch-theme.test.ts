import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { applyOklchTheme, getCuratedTheme, OKLCH_THEME_STORAGE_KEY } from '../lib/oklch-theme';
import { CURATED_OKLCH_THEMES } from '../data/oklch-presets';

describe('oklch-theme', () => {
  let mockStorage: Record<string, string> = {};
  let mockStyles: Record<string, string> = {};
  let mockClasses = new Set<string>();
  let mockAttributes: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    mockStyles = {};
    mockClasses = new Set();
    mockAttributes = {};

    const mockLocalStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => {
        mockStorage[key] = val;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
      length: 0,
      key: () => null,
    };
    (globalThis as unknown as { localStorage: unknown }).localStorage = mockLocalStorage;

    const mockDoc = {
      documentElement: {
        classList: {
          add: (cls: string) => mockClasses.add(cls),
          remove: (cls: string) => mockClasses.delete(cls),
          contains: (cls: string) => mockClasses.has(cls),
        },
        style: {
          setProperty: (prop: string, val: string) => {
            mockStyles[prop] = val;
          },
          removeProperty: (prop: string) => {
            const old = mockStyles[prop] ?? '';
            delete mockStyles[prop];
            return old;
          },
          getPropertyValue: (prop: string) => mockStyles[prop] ?? '',
        },
        setAttribute: (name: string, val: string) => {
          mockAttributes[name] = val;
        },
        removeAttribute: (name: string) => {
          delete mockAttributes[name];
        },
        hasAttribute: (name: string) => name in mockAttributes,
        getAttribute: (name: string) => mockAttributes[name] ?? null,
      },
    };
    (globalThis as unknown as { document: unknown }).document = mockDoc;
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    delete (globalThis as unknown as { document?: unknown }).document;
  });

  it('provides curated OKLCH terminal themes including solarized and gruvbox', () => {
    expect(CURATED_OKLCH_THEMES.length).toBeGreaterThanOrEqual(8);
    expect(getCuratedTheme('iterm2-solarized-dark')).toBeDefined();
    expect(getCuratedTheme('gruvbox-dark')).toBeDefined();
    expect(getCuratedTheme('nord')).toBeDefined();
    expect(getCuratedTheme('catppuccin-mocha')).toBeDefined();
  });

  it('applies dark theme and sets OKLCH surface variables', () => {
    const theme = getCuratedTheme('iterm2-solarized-dark');
    expect(theme).toBeDefined();
    applyOklchTheme(theme!);

    expect(mockClasses.has('dark')).toBe(true);
    expect(mockAttributes['data-oklch-theme']).toBe('iterm2-solarized-dark');
    expect(mockStyles['--surface-canvas']).toBe(theme!.colors.background);
    expect(mockStyles['--text-primary']).toBe(theme!.colors.foreground);
    expect(mockStorage[OKLCH_THEME_STORAGE_KEY]).toBe('iterm2-solarized-dark');
  });

  it('applies light theme and updates dark class accordingly', () => {
    const theme = getCuratedTheme('iterm2-solarized-light');
    expect(theme).toBeDefined();
    applyOklchTheme(theme!);

    expect(mockClasses.has('dark')).toBe(false);
    expect(mockAttributes['data-oklch-theme']).toBe('iterm2-solarized-light');
    expect(mockStyles['--surface-canvas']).toBe(theme!.colors.background);
  });

  it('clears overrides and restores default theme when passed null', () => {
    const theme = getCuratedTheme('nord');
    applyOklchTheme(theme!);
    expect('data-oklch-theme' in mockAttributes).toBe(true);

    applyOklchTheme(null);
    expect('data-oklch-theme' in mockAttributes).toBe(false);
    expect(mockStyles['--surface-canvas']).toBeUndefined();
    expect(mockStorage[OKLCH_THEME_STORAGE_KEY]).toBeUndefined();
  });
});
