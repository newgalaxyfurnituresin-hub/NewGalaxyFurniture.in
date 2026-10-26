import type { APIContext } from 'astro';
import { requireAdmin, readValidatedJson } from '@/lib/auth/guard';
import { getKV } from '@/lib/env';
import {
  ERROR_CODES,
  errorResponse,
  jsonResponse,
  logServerError,
  toClientErrorResponse,
} from '@/lib/errors';
import {
  EditorDraftInput,
  EditorDraftRecord,
  EditorDraftDelete,
  EditorScope,
  EDITOR_DRAFT_TTL_SECONDS,
  editorDraftKey,
  editorDraftPrefix,
  editorDraftHref,
} from '@/lib/products/editor-drafts';

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
  const guard = await requireAdmin(context, 'product.write');
  if (!guard.ok) return guard.response;
  try {
    const kv = getKV(context, 'DRAFTS');
    const scope = context.url.searchParams.get('scope');
    if (scope !== null) {
      if (!EditorScope.safeParse(scope).success)
        return errorResponse(ERROR_CODES.VALIDATION_FAILED);
      const raw = await kv.get(editorDraftKey(guard.session.userId, scope), 'json');
      const parsed = EditorDraftRecord.safeParse(raw);
      return jsonResponse({ draft: parsed.success ? parsed.data : null });
    }
    const page = await kv.list({
      prefix: editorDraftPrefix(guard.session.userId),
      ...(context.url.searchParams.get('cursor')
        ? { cursor: context.url.searchParams.get('cursor')! }
        : {}),
    });
    // Bounded reads keep a long recovery list below the free Worker's subrequest limit.
    const keys = page.keys
      .filter((key) => key.name.startsWith(editorDraftPrefix(guard.session.userId)))
      .slice(0, 20);
    const records = [];
    for (const key of keys) {
      const parsed = EditorDraftRecord.safeParse(await kv.get(key.name, 'json'));
      if (parsed.success) records.push(parsed.data);
    }
    return jsonResponse({
      drafts: records
        .sort((a, b) => b.savedAt - a.savedAt)
        .map((record) => ({
          scope: record.scope,
          name: record.patch.name?.trim() || 'Unnamed furniture draft',
          savedAt: record.savedAt,
          href: editorDraftHref(record.scope),
        })),
      limited: page.keys.length > keys.length || !page.list_complete,
    });
  } catch (error) {
    logServerError('editor-drafts: read failed', error);
    return toClientErrorResponse(error);
  }
}

export async function POST(context: APIContext): Promise<Response> {
  const guard = await requireAdmin(context, 'product.write');
  if (!guard.ok) return guard.response;
  const body = await readValidatedJson(context.request, EditorDraftInput);
  if (!body.ok) return body.response;
  try {
    const kv = getKV(context, 'DRAFTS');
    const key = editorDraftKey(guard.session.userId, body.value.scope);
    const parsed = EditorDraftRecord.safeParse(await kv.get(key, 'json'));
    const current = parsed.success ? parsed.data : null;
    if ((current?.revision ?? null) !== body.value.expectedRevision) {
      // Retry a response lost on the network without rewriting or creating another draft.
      if (
        current &&
        current.baseUpdatedAt === body.value.baseUpdatedAt &&
        JSON.stringify(current.patch) === JSON.stringify(body.value.patch)
      )
        return jsonResponse({ draft: current });
      return errorResponse(ERROR_CODES.CONFLICT, {
        message:
          'This recovery draft changed in another tab or device. Your current details are still saved on this device.',
        remote: current,
      });
    }
    const draft = {
      scope: body.value.scope,
      baseUpdatedAt: body.value.baseUpdatedAt,
      patch: body.value.patch,
      revision: crypto.randomUUID(),
      savedAt: Date.now(),
    };
    await kv.put(key, JSON.stringify(draft), { expirationTtl: EDITOR_DRAFT_TTL_SECONDS });
    return jsonResponse({ draft });
  } catch (error) {
    logServerError('editor-drafts: save failed', error);
    return toClientErrorResponse(error);
  }
}

export async function DELETE(context: APIContext): Promise<Response> {
  const guard = await requireAdmin(context, 'product.write');
  if (!guard.ok) return guard.response;
  const body = await readValidatedJson(context.request, EditorDraftDelete);
  if (!body.ok) return body.response;
  try {
    const kv = getKV(context, 'DRAFTS');
    const key = editorDraftKey(guard.session.userId, body.value.scope);
    const parsed = EditorDraftRecord.safeParse(await kv.get(key, 'json'));
    if (parsed.success && parsed.data.revision !== body.value.revision)
      return errorResponse(ERROR_CODES.CONFLICT);
    await kv.delete(key);
    return new Response(null, { status: 204 });
  } catch (error) {
    logServerError('editor-drafts: clear failed', error);
    return toClientErrorResponse(error);
  }
}
