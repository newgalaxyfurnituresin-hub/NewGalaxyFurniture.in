import { describe, expect, it } from 'vitest';
import {
  publicationElapsed,
  publicationIsLive,
  type PendingPublication,
  type PublicationReceipt,
} from '@/lib/admin/publication';

const pending: PendingPublication = {
  id: 'p_example',
  slug: 'example',
  updatedAt: '2026-10-19T18:00:00.000Z',
  to: 'PUBLISHED',
  commitSha: 'abc',
  startedAt: 0,
};
const receipt: PublicationReceipt = {
  generatedAt: '2026-10-19T18:01:00.000Z',
  products: [
    { id: pending.id, slug: pending.slug, updatedAt: pending.updatedAt, status: 'PUBLISHED' },
  ],
};
describe('verification of the actual public product version', () => {
  it('confirms the exact version on a deployment built after the save', () => {
    expect(publicationIsLive(receipt, pending)).toBe(true);
  });
  it('does not mistake an older deployment for success', () => {
    expect(
      publicationIsLive({ ...receipt, generatedAt: '2026-10-19T17:00:00.000Z' }, pending),
    ).toBe(false);
    expect(
      publicationIsLive(
        {
          ...receipt,
          products: [{ ...receipt.products[0]!, updatedAt: '2026-10-19T17:00:00.000Z' }],
        },
        pending,
      ),
    ).toBe(false);
  });
  it('does not confirm another product, slug, or availability status', () => {
    for (const replacement of [
      { id: 'another' },
      { slug: 'another' },
      { status: 'OUT_OF_STOCK' as const },
    ]) {
      expect(
        publicationIsLive(
          { ...receipt, products: [{ ...receipt.products[0]!, ...replacement }] },
          pending,
        ),
      ).toBe(false);
    }
  });
  it('confirms an unpublish only when absent from a sufficiently recent build', () => {
    const removal = { ...pending, to: 'UNPUBLISHED' as const };
    expect(publicationIsLive(receipt, removal)).toBe(false);
    expect(publicationIsLive({ ...receipt, products: [] }, removal)).toBe(true);
    expect(
      publicationIsLive({ generatedAt: '2026-10-19T17:00:00.000Z', products: [] }, removal),
    ).toBe(false);
  });
  it('rejects an invalid build timestamp', () => {
    expect(publicationIsLive({ ...receipt, generatedAt: 'bad date' }, pending)).toBe(false);
  });
  it('formats elapsed time without a fictional countdown', () => {
    expect(publicationElapsed(0)).toBe('0:00');
    expect(publicationElapsed(65)).toBe('1:05');
    expect(publicationElapsed(-2)).toBe('0:00');
  });
});
