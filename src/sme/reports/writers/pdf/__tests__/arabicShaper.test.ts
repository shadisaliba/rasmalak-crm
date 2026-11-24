/**
 * Execution tests for the RTL shaper's two report-breaking defects:
 * bracket mirroring and page-label ordering.
 */
import { describe, it, expect } from 'vitest';
import { shapeArabic } from '../arabic';

// Arabic-Indic digits
const D1 = 0x0661; // ١
const D5 = 0x0665; // ٥
const LPAREN = 0x0028;
const RPAREN = 0x0029;

describe('bracket mirroring', () => {
  it('keeps an opening paren opening the enclosed Arabic after RTL reversal', () => {
    // Logical «(ب)» must render with "(" on the left and ")" on the right,
    // i.e. the visual glyph stream starts with ( and ends with ) — not «)ب(».
    const out = shapeArabic('(ب)');
    expect(out[0]).toBe(LPAREN);
    expect(out[out.length - 1]).toBe(RPAREN);
  });

  it('mirrors both parens around a multi-word Arabic phrase', () => {
    const out = shapeArabic('(السعودية)');
    expect(out[0]).toBe(LPAREN);
    expect(out[out.length - 1]).toBe(RPAREN);
  });
});

describe('page-label ordering', () => {
  it('renders "صفحة ١ من ٥" so that ٥ sits left of ١ (reads "1 of 5", not "5 of 1")', () => {
    // In correct RTL visual order the total (٥) is leftmost and the current
    // page (١) is to its right; the old code inverted this to «٥ من ١».
    const out = shapeArabic('صفحة ١ من ٥');
    expect(out).toContain(D1);
    expect(out).toContain(D5);
    expect(out.indexOf(D5)).toBeLessThan(out.indexOf(D1));
  });
});

describe('joining after right-joining letters', () => {
  // Presentation forms: lam initial FEDF, lam final FEDE; dal final FEAA; reh isolated FEAD;
  // seen initial FEB3; teh marbuta final FE94; meem initial FEE3; alef isolated FE8D.
  it('starts a new join after alef: "ال" is an isolated alef then an initial lam', () => {
    // Glyphs come out in visual (reversed) order.
    const al = shapeArabic('ال');
    expect(al).toEqual([0xfedd, 0xfe8d]);
    expect(shapeArabic('العميل').at(-2)).toBe(0xfedf);
  });

  it('shapes "مدرسة" as meem-dal joined, reh alone, seen-teh marbuta joined', () => {
    expect(shapeArabic('مدرسة')).toEqual([0xfe94, 0xfeb3, 0xfead, 0xfeaa, 0xfee3]);
  });
});

describe('isolated and final forms of right-joining letters', () => {
  it('uses the isolated form at the start and the final form after a joining letter', () => {
    // و د ذ ر ز: isolated alone; final after ب (dual-joining).
    const cases: Array<[number, number, number]> = [[0x0648, 0xfeed, 0xfeee], [0x062f, 0xfea9, 0xfeaa], [0x0630, 0xfeab, 0xfeac], [0x0631, 0xfead, 0xfeae], [0x0632, 0xfeaf, 0xfeb0]];
    for (const [letter, isolated, final] of cases) {
      expect(shapeArabic(String.fromCodePoint(letter))).toEqual([isolated]);
      expect(shapeArabic(String.fromCodePoint(0x0628, letter))[0]).toBe(final);
    }
  });
});
