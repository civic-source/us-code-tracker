import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_FILE = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(TEST_FILE);
const WEB_SRC_DIR = join(TEST_DIR, '..');
const SOURCE_EXTENSIONS = new Set(['.svelte', '.astro', '.ts', '.css']);
const INVALID_PADDING_CLASS = ['py-0', '2'].join('.');
const INVALID_PADDING_REGEX = new RegExp(`\\b${INVALID_PADDING_CLASS.replace('.', '\\.')}(?!\\d)`);

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface RgbaColor extends RgbColor {
  a: number;
}

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractCssBlock(css: string, headerPattern: RegExp): string {
  const match = headerPattern.exec(css);
  if (!match || match.index === undefined) {
    throw new Error(`CSS block matching ${headerPattern.source} not found`);
  }
  const braceStart = css.indexOf('{', match.index);
  if (braceStart < 0) {
    throw new Error(`Opening brace not found for ${headerPattern.source}`);
  }
  let depth = 0;
  for (let i = braceStart; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return css.slice(braceStart + 1, i);
      }
    }
  }
  throw new Error(`Unclosed CSS block for ${headerPattern.source}`);
}

function getCssToken(block: string, tokenName: string): string {
  const escaped = tokenName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|;|\\s)${escaped}\\s*:\\s*([^;]+);`).exec(block);
  const value = match?.[1]?.trim();
  if (!value) {
    throw new Error(`CSS token ${tokenName} not found in block`);
  }
  return value;
}

function parseCssColor(raw: string): RgbaColor {
  const trimmed = raw.trim();
  const hexMatch = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (hexMatch?.[1]) {
    const hex = hexMatch[1];
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgbaMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
    trimmed
  );
  if (rgbaMatch?.[1] && rgbaMatch[2] && rgbaMatch[3]) {
    return {
      r: Number(rgbaMatch[1]),
      g: Number(rgbaMatch[2]),
      b: Number(rgbaMatch[3]),
      a: rgbaMatch[4] !== undefined ? Number(rgbaMatch[4]) : 1,
    };
  }

  throw new Error(`Unsupported CSS color format: "${raw}"`);
}

function compositeOver(fg: RgbaColor, bg: RgbColor): RgbColor {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  };
}

function srgbToLinear(channel255: number): number {
  const srgb = channel255 / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: RgbColor): number {
  return (
    0.2126 * srgbToLinear(color.r) +
    0.7152 * srgbToLinear(color.g) +
    0.0722 * srgbToLinear(color.b)
  );
}

function contrastRatio(fg: RgbColor, bg: RgbColor): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('WCAG 2.1 AA design tokens and utility classes', () => {
  it(`contains zero occurrences of invalid Tailwind utility ${INVALID_PADDING_CLASS} across apps/web/src`, () => {
    const offending: string[] = [];
    for (const filePath of collectSourceFiles(WEB_SRC_DIR)) {
      if (filePath === TEST_FILE) continue;
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (INVALID_PADDING_REGEX.test(line)) {
          offending.push(`${relative(WEB_SRC_DIR, filePath)}:${index + 1}`);
        }
      });
    }
    expect(offending).toEqual([]);
  });

  it('meets WCAG 2.1 AA (>= 4.5:1) contrast for caution and valid legal tokens in light and dark modes', () => {
    const tokensCss = stripCssComments(readFileSync(join(WEB_SRC_DIR, 'styles/tokens.css'), 'utf-8'));
    const globalCss = stripCssComments(readFileSync(join(WEB_SRC_DIR, 'styles/global.css'), 'utf-8'));

    const lightTokens = extractCssBlock(tokensCss, /:root\s*\{/);
    const darkTokens = extractCssBlock(tokensCss, /:where\(\.dark,\s*\.dark \*\)\s*\{/);
    const themeTokens = extractCssBlock(globalCss, /@theme\s*\{/);

    const lightCaution = parseCssColor(getCssToken(lightTokens, '--legal-caution'));
    const lightCautionBg = parseCssColor(getCssToken(lightTokens, '--legal-caution-bg'));
    expect(contrastRatio(lightCaution, lightCautionBg)).toBeGreaterThanOrEqual(4.5);

    const lightAmber = parseCssColor(getCssToken(themeTokens, '--color-amber'));
    const warmWhite = parseCssColor(getCssToken(themeTokens, '--color-warm-white'));
    expect(contrastRatio(lightAmber, lightCautionBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightAmber, warmWhite)).toBeGreaterThanOrEqual(4.5);

    const lightValid = parseCssColor(getCssToken(lightTokens, '--legal-valid'));
    const lightValidBg = parseCssColor(getCssToken(lightTokens, '--legal-valid-bg'));
    expect(contrastRatio(lightValid, lightValidBg)).toBeGreaterThanOrEqual(4.5);

    const darkSurfaceRaised = parseCssColor(getCssToken(darkTokens, '--surface-raised'));
    const darkValid = parseCssColor(getCssToken(darkTokens, '--legal-valid'));
    const darkValidBg = compositeOver(
      parseCssColor(getCssToken(darkTokens, '--legal-valid-bg')),
      darkSurfaceRaised
    );
    expect(contrastRatio(darkValid, darkValidBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('uses semantic legal-valid tokens instead of bg-teal/15 text-teal on the FederalRegisterActivity Static Snapshot badge', () => {
    const svelteSource = readFileSync(
      join(WEB_SRC_DIR, 'components/FederalRegisterActivity.svelte'),
      'utf-8'
    );
    const badgeMatch = /<span\s+class="([^"]+)">\s*Static Snapshot \(\{coverageState\}\)\s*<\/span>/.exec(
      svelteSource
    );
    expect(badgeMatch).not.toBeNull();
    const classes = badgeMatch?.[1] ?? '';
    expect(classes).not.toContain('bg-teal/15');
    expect(classes).not.toContain('text-teal');
    expect(classes).toContain('var(--legal-valid-bg)');
    expect(classes).toContain('var(--legal-valid)');
  });
});
