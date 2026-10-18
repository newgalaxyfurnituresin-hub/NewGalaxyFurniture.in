import type { APIContext } from 'astro';
import { openAdminContext } from '@/lib/admin/context';
import { readValidatedJson } from '@/lib/auth/guard';
import {
  ERROR_CODES,
  errorResponse,
  jsonResponse,
  logServerError,
  toClientErrorResponse,
} from '@/lib/errors';
import { readContentRecord, writeContentRecord } from '@/lib/github/content-writer';
import { siteContentPath } from '@/lib/github/paths';
import { ExperiencesSchema, ExperiencesUpdateSchema } from '@/schemas/experiences';

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
  const opened = await openAdminContext(context, 'product.read');
  if (!opened.ok) return opened.response;
  const path = siteContentPath('experiences');
  if (path === null) return errorResponse(ERROR_CODES.PATH_NOT_ALLOWED);
  try {
    const record = await readContentRecord(opened.context.client, path, ExperiencesSchema);
    return record === null
      ? errorResponse(ERROR_CODES.NOT_FOUND)
      : jsonResponse({ experiences: record.value, sha: record.sha });
  } catch (error) {
    logServerError('experiences: read failed', error);
    return toClientErrorResponse(error);
  }
}

export async function PATCH(context: APIContext): Promise<Response> {
  const opened = await openAdminContext(context, 'settings.write');
  if (!opened.ok) return opened.response;
  const body = await readValidatedJson(context.request, ExperiencesUpdateSchema);
  if (!body.ok) return body.response;
  const path = siteContentPath('experiences');
  if (path === null) return errorResponse(ERROR_CODES.PATH_NOT_ALLOWED);
  try {
    const { client, actor } = opened.context;
    const stored = await readContentRecord(client, path, ExperiencesSchema);
    if (stored === null || stored.sha === undefined) return errorResponse(ERROR_CODES.NOT_FOUND);
    if (stored.sha !== body.value.sha)
      return errorResponse(ERROR_CODES.CONFLICT, {
        remote: { experiences: stored.value, sha: stored.sha },
      });
    const result = await writeContentRecord({
      client,
      path,
      actor,
      record: body.value.experiences,
      scope: 'site',
      action: 'update',
      subject: { name: 'repair and mattress experiences' },
      skipCi: false,
      sha: stored.sha,
    });
    // The blob SHA is re-read by the next GET; a commit SHA must never stand in for a blob SHA.
    return jsonResponse({ commitSha: result.commitSha, deployTriggered: true });
  } catch (error) {
    logServerError('experiences: update failed', error);
    return toClientErrorResponse(error);
  }
}
