import { z } from 'zod';

/** Only local, public image paths: no external trackers, SVG, query strings or traversal. */
export const EditorialPhotoSchema = z.object({
  src: z
    .string()
    .regex(
      /^\/(?:brand\/[a-zA-Z0-9_-]+|products\/[a-zA-Z0-9/_-]+|img\/p_[a-z0-9]{10}\/img_[a-z0-9]{10}(?:-\d+)?)\.(?:webp|avif|png|jpe?g)$/,
    ),
  alt: z.string().trim().min(5).max(240),
  width: z.number().int().positive().max(12000),
  height: z.number().int().positive().max(12000),
  caption: z.string().trim().min(1).max(240),
});

export const RepairServiceSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(60),
    title: z.string().trim().min(2).max(80),
    description: z.string().trim().min(10).max(400),
    enabled: z.boolean(),
    confirmed: z.boolean(),
    photo: EditorialPhotoSchema,
  })
  .passthrough();

export const ExperiencesSchema = z
  .object({
    repair: z
      .object({
        homeEnabled: z.boolean(),
        heading: z.string().trim().min(10).max(100),
        description: z.string().trim().min(20).max(400),
        hero: EditorialPhotoSchema,
        services: z
          .array(RepairServiceSchema)
          .max(12)
          .refine(
            (items) => new Set(items.map((item) => item.id)).size === items.length,
            'Service identifiers must be unique.',
          ),
        faqs: z
          .array(
            z.object({
              question: z.string().trim().min(5).max(180),
              answer: z.string().trim().min(10).max(700),
            }),
          )
          .max(12),
        projects: z
          .array(
            z.object({
              title: z.string().trim().min(2).max(100),
              description: z.string().trim().min(10).max(400),
              confirmed: z.boolean(),
              before: EditorialPhotoSchema,
              after: EditorialPhotoSchema,
            }),
          )
          .max(12),
      })
      .passthrough(),
    mattresses: z
      .object({
        homeEnabled: z.boolean(),
        heading: z.string().trim().min(10).max(100),
        description: z.string().trim().min(20).max(400),
        hero: EditorialPhotoSchema,
      })
      .passthrough(),
  })
  .passthrough();

export type Experiences = z.infer<typeof ExperiencesSchema>;
export type EditorialPhoto = z.infer<typeof EditorialPhotoSchema>;
export type RepairService = z.infer<typeof RepairServiceSchema>;
export const ExperiencesUpdateSchema = z
  .object({
    sha: z.string().regex(/^[0-9a-f]{40}$/),
    experiences: ExperiencesSchema,
  })
  .strict();
