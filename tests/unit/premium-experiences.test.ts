import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { experiences } from '@/lib/content/experiences';
import { EditorialPhotoSchema, ExperiencesSchema } from '@/schemas/experiences';
import { repairRequirement } from '@/lib/leads/repair';
import { LeadSchema } from '@/schemas/lead';
import { mattressOption } from '@/lib/products/mattress-options';
import { toSearchDoc } from '@/lib/search/build-index';
import { facetVocabulary, filter, neutralState } from '@/lib/search/filter';
import { findAdminRoute } from '@/lib/auth/routes';
import { can } from '@/lib/auth/permissions';
import { siteContentPath, resolveContentPath } from '@/lib/github/paths';
import { readHeaderDimensions } from '@/lib/images/dimensions';
import { readFileSync } from 'node:fs';
import { demoSofa } from '../fixtures/products';
import RepairQuoteForm from '@/components/forms/RepairQuoteForm';
import ExperiencesEditor from '@/components/admin/ExperiencesEditor';

describe('honest, editable repair content', () => {
  it('reads the actual uploaded WebP dimensions before allocating decoded pixels', () => {
    const bytes = new Uint8Array(readFileSync('public/brand/mattress-inspiration-1040.webp'));
    expect(readHeaderDimensions(bytes, 'webp')).toEqual({ width: 1040, height: 693 });
    expect(readHeaderDimensions(bytes.slice(0, 29), 'webp')).toBeNull();
    const damaged = bytes.slice();
    damaged[23] = 0;
    expect(readHeaderDimensions(damaged, 'webp')).toBeNull();
  });
  it('ships only assessment topics and no fabricated project evidence', () => {
    expect(ExperiencesSchema.safeParse(experiences).success).toBe(true);
    expect(experiences.repair.services.every((service) => !service.confirmed)).toBe(true);
    expect(experiences.repair.projects).toEqual([]);
    expect(experiences.mattresses.hero.caption).toMatch(/illustrative/i);
  });
  it('refuses external, executable, traversal and private enquiry photos', () => {
    for (const src of [
      'https://example.test/photo.webp',
      'javascript:alert(1)',
      '/brand/../secret.webp',
      '/img/quarantine/private.webp',
      '/brand/x.svg',
      '/brand/x.webp?token=secret',
    ]) {
      expect(EditorialPhotoSchema.safeParse({ ...experiences.repair.hero, src }).success, src).toBe(
        false,
      );
    }
    expect(
      EditorialPhotoSchema.safeParse({
        ...experiences.repair.hero,
        src: '/img/p_1234567890/img_1234567890-640.webp',
      }).success,
    ).toBe(true);
  });
  it('rejects duplicated service identifiers and overly large content', () => {
    const copy = structuredClone(experiences);
    copy.repair.services.push(copy.repair.services[0]!);
    expect(ExperiencesSchema.safeParse(copy).success).toBe(false);
    expect(
      ExperiencesSchema.safeParse({
        ...experiences,
        repair: { ...experiences.repair, heading: 'x'.repeat(101) },
      }).success,
    ).toBe(false);
  });
  it('uses the existing validated lead contract and stays within its bounds', () => {
    const requirement = repairRequirement('A'.repeat(104), 'B'.repeat(80), 'WhatsApp');
    const lead = {
      type: 'QUOTE',
      name: 'Local Test',
      phone: '9876543210',
      message: 'Please assess the cushion on this sofa.',
      renderedAt: Date.now(),
      requirement,
    };
    expect(LeadSchema.safeParse(lead).success).toBe(true);
    expect(requirement).toContain('Sofa repair enquiry');
    expect(requirement).toContain('Preferred contact: WhatsApp');
    expect(LeadSchema.safeParse({ ...lead, phone: '123' }).success).toBe(false);
  });
  it('renders an accessible shared form and no checkout or booking promise', () => {
    const html = renderToString(
      createElement(RepairQuoteForm, { numbers: [], services: ['Cushion assessment'] }),
    );
    expect(html).toContain('data-ngf-enquiry-form="QUOTE"');
    expect(html).toContain('Cushion assessment');
    expect(html).toContain('type="tel"');
    expect(html).toContain('type="file"');
    expect(html).toContain('does not book a service');
  });
});

describe('mattress catalogue reuses real product data', () => {
  const mattress = {
    ...demoSofa,
    category: 'mattresses',
    size: 'Standard',
    price: 12000,
    variants: [
      { id: 'queen', label: 'Queen', priceDelta: 2000, stockStatus: 'OUT_OF_STOCK' as const },
      { id: 'king', label: 'King', priceDelta: 4000 },
    ],
  };
  it('derives absolute option prices and inherits availability only when absent', () => {
    expect(mattressOption(mattress, mattress.variants[0]!)).toMatchObject({
      price: 14000,
      stockStatus: 'OUT_OF_STOCK',
    });
    expect(mattressOption(mattress, mattress.variants[1]!)).toMatchObject({
      price: 16000,
      stockStatus: mattress.stockStatus,
    });
    expect(
      mattressOption({ ...mattress, price: null, priceOnEnquiry: true }, mattress.variants[0]!)
        .price,
    ).toBeNull();
  });
  it('filters actual variant sizes without duplicating product records', () => {
    const doc = toSearchDoc(mattress);
    expect(facetVocabulary([doc]).size).toEqual(['Standard', 'Queen', 'King']);
    expect(filter([doc], { ...neutralState(), size: ['Queen'] })).toHaveLength(1);
    expect(filter([doc], { ...neutralState(), size: ['Single'] })).toHaveLength(0);
    expect(toSearchDoc(demoSofa).vs).toBeUndefined();
  });
});

describe('owner administration stays within the existing security model', () => {
  it('allows only the exact new content file and requires settings.write for mutations', () => {
    expect(siteContentPath('experiences')).toBe('data/site/experiences.json');
    expect(resolveContentPath('data/site/experiences/anything.json')).toBeNull();
    expect(findAdminRoute('PATCH', '/api/admin/experiences')?.auth).toEqual({
      kind: 'permission',
      permission: 'settings.write',
    });
    expect(can('viewer', 'settings.write')).toBe(false);
    expect(can('editor', 'settings.write')).toBe(false);
    expect(can('owner', 'settings.write')).toBe(true);
  });
  it('renders add controls for owners and a non-mutating view for viewers', () => {
    const owner = renderToString(
      createElement(ExperiencesEditor, {
        initial: experiences,
        initialSha: 'a'.repeat(40),
        canWrite: true,
      }),
    );
    expect(owner).toContain('Add repair topic');
    expect(owner).toContain('Add project');
    const viewer = renderToString(
      createElement(ExperiencesEditor, {
        initial: experiences,
        initialSha: 'a'.repeat(40),
        canWrite: false,
      }),
    );
    expect(viewer).not.toContain('Save experience content');
    expect(viewer).not.toContain('Add repair topic');
  });
});
