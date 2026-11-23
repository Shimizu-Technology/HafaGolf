import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const platformDir = dirname(fileURLToPath(import.meta.url));
const pagePath = join(platformDir, '../../pages/PlatformHomePage.tsx');
const sourceFiles = [
  pagePath,
  ...readdirSync(platformDir)
    .filter((name) => /\.(ts|tsx)$/.test(name) && !name.includes('.test.'))
    .map((name) => join(platformDir, name)),
];

describe('platform homepage motion budget', () => {
  it('keeps the custom motion script well under 10 KB', () => {
    const motion = readFileSync(join(platformDir, 'motion.ts'));
    expect(motion.byteLength).toBeLessThan(10 * 1024);
    expect(gzipSync(motion).byteLength).toBeLessThan(4 * 1024);
  });

  it('uses no animation or smooth-scroll libraries', () => {
    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/from ['"](framer-motion|motion|gsap|lenis|@studio-freight\/lenis)['"/]/);
    }
  });

  it('never animates layout properties in its stylesheet', () => {
    const css = readFileSync(join(platformDir, 'platform.css'), 'utf8');
    const keyframes = css.match(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g) ?? [];
    expect(keyframes.length).toBeGreaterThan(0);
    for (const block of keyframes) {
      expect(block).not.toMatch(/\b(top|left|right|bottom|width|height|margin|padding)\s*:/);
    }
  });
});
