import { describe, expect, it } from 'vitest';
import { escapeHtml, targetDimensions } from '../../scripts/enhance-photos';

describe('local photo preparation', () => {
  it('prepares a 4K long edge while preserving landscape and portrait shapes', () => {
    expect(targetDimensions(1470, 1070)).toEqual({ width: 3840, height: 2795 });
    expect(targetDimensions(1070, 1470)).toEqual({ width: 2795, height: 3840 });
    expect(targetDimensions(2000, 2000)).toEqual({ width: 3840, height: 3840 });
    expect(targetDimensions(7680, 4320)).toEqual({ width: 3840, height: 2160 });
  });

  it('rejects invalid dimensions instead of generating an invalid resize request', () => {
    for (const width of [0, -1, NaN, Infinity, 1.5]) {
      expect(() => targetDimensions(width, 100)).toThrow('Invalid photo dimensions');
    }
  });

  it('does not turn a photo filename into executable review markup', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)"> & \'photo\'')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;photo&#39;',
    );
  });
});
