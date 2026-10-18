/** Workerd instantiates imported WASM modules; compiling Node byte arrays is forbidden there. */
import * as photon from '@cf-wasm/photon/workerd';
import encodeAvif, { init as initAvifEncoder } from '@jsquash/avif/encode.js';
import decodeAvif, { init as initAvifDecoder } from '@jsquash/avif/decode.js';
import encoderModule from '@jsquash/avif/codec/enc/avif_enc.wasm';
import decoderModule from '@jsquash/avif/codec/dec/avif_dec.wasm';
import { avifApiFrom, photonApiFrom, type AvifLib, type PhotonLib } from './codec-adapters';
import { createCodec, type ImageCodec } from './codec';

const avif: AvifLib = {
  initEncode: (module) => initAvifEncoder(module),
  encode: (image, options) => encodeAvif(image as unknown as ImageData, options),
  initDecode: (module) => initAvifDecoder(module),
  decode: async (bytes) => await decodeAvif(bytes),
};

export function createWorkerCodec(): ImageCodec {
  return createCodec(
    photonApiFrom(photon as unknown as PhotonLib),
    avifApiFrom(avif, encoderModule, decoderModule),
  );
}
