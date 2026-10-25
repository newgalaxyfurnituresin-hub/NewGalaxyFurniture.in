import sharp from 'sharp';
import type { HostedImageService } from '@/lib/images/hosted';
/** A protocol fixture with real pixel decoding; production uses Cloudflare's remote binding. */
export function hostedImageFixture(): HostedImageService {
  return {
    info: async (stream) => {
      const metadata = await sharp(
        Buffer.from(await new Response(stream).arrayBuffer()),
      ).metadata();
      return { width: metadata.width, height: metadata.height };
    },
    input: (stream) => {
      const source = new Response(stream).arrayBuffer();
      let width: number | undefined;
      const handle: ReturnType<HostedImageService['input']> = {
        transform: (options) => {
          width = options.width ?? width;
          return handle;
        },
        output: async (options) => {
          let pipe = sharp(Buffer.from(await source)).rotate();
          if (width) pipe = pipe.resize({ width, withoutEnlargement: true });
          const bytes = await (
            options.format === 'image/webp'
              ? pipe.webp({ quality: options.quality })
              : pipe.jpeg({ quality: options.quality })
          ).toBuffer();
          return {
            response: () =>
              new Response(new Uint8Array(bytes), { headers: { 'content-type': options.format } }),
          };
        },
      };
      return handle;
    },
  };
}
