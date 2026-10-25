/** Compatibility route: uploads are quarantined and prepared off the free Worker. */
import type { APIContext } from 'astro';
import { POST as stagePhoto } from '../photo-uploads';
export { MAX_UPLOAD_BODY_BYTES } from '../photo-uploads';
export const prerender = false;
export const MAX_IMAGES_PER_PRODUCT = 20;
export async function POST(context: APIContext): Promise<Response> {
  return await stagePhoto(context);
}
