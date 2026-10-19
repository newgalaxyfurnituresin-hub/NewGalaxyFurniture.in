import { describe, expect, it } from 'vitest';
import { advanceProductRevision, productRevisionHeaders } from '@/lib/products/revision';

describe('image save revisions', () => {
  it('allows a following text save after an image edit from the same version', () => {
    expect(
      advanceProductRevision('loaded', { previousUpdatedAt: 'loaded', updatedAt: 'image-saved' }),
    ).toBe('image-saved');
  });
  it('keeps the stale version when another editor changed the product before the image edit', () => {
    expect(
      advanceProductRevision('loaded', {
        previousUpdatedAt: 'other-editor',
        updatedAt: 'image-saved',
      }),
    ).toBe('loaded');
  });
  it('does not invent a revision when the server did not confirm one', () => {
    expect(advanceProductRevision('loaded')).toBe('loaded');
    expect(productRevisionHeaders('before', 'after')).toEqual({
      'x-ngf-previous-updated-at': 'before',
      'x-ngf-updated-at': 'after',
    });
  });
});
