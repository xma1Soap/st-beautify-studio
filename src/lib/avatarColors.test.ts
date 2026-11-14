import { describe, expect, it } from 'vitest';
import { hslToHex, mainColors, palettesFrom, rgbToHsl } from './avatarColors';

const pixels = (list: [number, number, number, number][]) => list.flatMap(([r, g, b, n]) => Array.from({ length: n }, () => [r, g, b, 255]).flat());

describe('colors from a picture', () => {
  it('finds the main colors, biggest first, leaving out see-through pixels', () => {
    const px = [...pixels([[200, 40, 60, 60], [30, 30, 40, 30], [40, 160, 220, 10]]), 0, 0, 0, 0];
    const m = mainColors(px, 3);
    expect(m.map((s) => s.rgb)).toEqual([[200, 40, 60], [30, 30, 40], [40, 160, 220]]);
    expect(m[0].share).toBeCloseTo(0.6);
  });
  it('turns them into a dark and a light palette with the most colorful one as the main color', () => {
    const p = palettesFrom(mainColors(pixels([[30, 30, 40, 60], [200, 40, 60, 25], [40, 160, 220, 15]]), 3));
    expect(p.map((x) => x.name)).toEqual(['头像·深色', '头像·浅色']);
    const [dark, light] = p;
    // main color: the red; second: the blue
    expect(rgbToHsl(hexRgb(dark.colors.accent))[0]).toBeCloseTo(rgbToHsl([200, 40, 60])[0], 0);
    expect(Math.abs(rgbToHsl(hexRgb(dark.colors.accent2))[0] - rgbToHsl([40, 160, 220])[0])).toBeLessThan(2);
    expect(rgbToHsl(hexRgb(dark.colors.bg))[2]).toBeLessThan(0.15);
    expect(rgbToHsl(hexRgb(light.colors.bg))[2]).toBeGreaterThan(0.9);
    expect(rgbToHsl(hexRgb(light.colors.text))[2]).toBeLessThan(0.3);
  });
  it('round-trips colors through HSL', () => {
    expect(hslToHex(...rgbToHsl([200, 40, 60]))).toBe('#c8283c');
  });
});

function hexRgb(h: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
