import { z } from 'zod';
import { ProductEditorPatch } from './input';

export const EDITOR_DRAFT_TTL_SECONDS = 30 * 24 * 60 * 60;
export const EditorScope = z.string().regex(/^(?:p_[a-z0-9]{10}|new_[a-f0-9]{32})$/);
export const EditorDraftInput = z
  .object({
    scope: EditorScope,
    baseUpdatedAt: z.string().max(60),
    expectedRevision: z.string().max(80).nullable(),
    patch: ProductEditorPatch,
  })
  .strict();
export const EditorDraftRecord = z
  .object({
    scope: EditorScope,
    baseUpdatedAt: z.string().max(60),
    revision: z.string().max(80),
    savedAt: z.number().finite(),
    patch: ProductEditorPatch,
  })
  .strict();
export const EditorDraftDelete = z
  .object({ scope: EditorScope, revision: z.string().max(80).nullable() })
  .strict();
export type EditorDraft = z.infer<typeof EditorDraftRecord>;
export type EditorPatch = z.infer<typeof ProductEditorPatch>;

export function editorDraftPrefix(userId: string): string {
  return `editor-draft:${userId}:`;
}
export function editorDraftKey(userId: string, scope: string): string {
  return editorDraftPrefix(userId) + scope;
}
export function editorDraftHref(scope: string): string {
  return scope.startsWith('new_')
    ? `/admin/products/new?draft=${scope}`
    : `/admin/products/${scope}`;
}
