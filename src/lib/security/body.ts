/** Limit actual streamed bytes, including requests that omit or understate Content-Length. */
export class BodyTooLargeError extends Error {
  constructor() {
    super('The request is too large. Send a smaller request.');
  }
}

export async function readBoundedBody(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (request.body === null) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export async function readBoundedJson(request: Request, maxBytes = 256 * 1024): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await readBoundedBody(request, maxBytes))) as unknown;
}

export async function readBoundedForm(request: Request, maxBytes: number): Promise<FormData> {
  return new Response(await readBoundedBody(request, maxBytes), {
    headers: { 'content-type': request.headers.get('content-type') ?? '' },
  }).formData();
}
