import { BadRequestException } from '@nestjs/common';
import { pipeline, Readable, Transform } from 'stream';
import { IUploadProvider } from './upload.interface';
import {
  MAX_UPLOAD_IMAGE_BYTES,
  MAX_UPLOAD_VIDEO_BYTES,
  UPLOAD_EXTENSIONS,
} from '@gitroom/helpers/utils/media.upload';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fileTypeFromBuffer, fileTypeStream } = require('file-type');

export { UPLOAD_EXTENSIONS };
export const UPLOAD_ALLOWED_MIME = new Set(UPLOAD_EXTENSIONS.keys());

export function getMaxSize(mimeType: string): number {
  if (mimeType.startsWith('image/')) {
    return MAX_UPLOAD_IMAGE_BYTES;
  } else if (mimeType.startsWith('video/')) {
    return MAX_UPLOAD_VIDEO_BYTES;
  } else {
    throw new BadRequestException('Unsupported file type.');
  }
}

// Passes bytes through and fails once they exceed maxSize, so a body with a
// missing or lying Content-Length cannot be streamed into storage unbounded
export function maxSizeStream(maxSize: number) {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > maxSize) {
        return callback(new BadRequestException('File is too large.'));
      }
      callback(null, chunk);
    },
  });
}

export const MEDIA_SNIFF_BYTES = 4100;

// A classic TIFF can put its first image directory after the pixel data.
function hasTiffHeader(prefix: Buffer) {
  if (prefix.length < 4) return false;
  const signature = prefix.readUInt32BE(0);
  return signature === 0x49492a00 || signature === 0x4d4d002a;
}

type DetectedType = { mime: string; ext: string };

export async function detectMediaType(
  prefix: Buffer,
  readTiff: () => Promise<Buffer>
): Promise<DetectedType | undefined> {
  const detected = await fileTypeFromBuffer(prefix).catch(() => undefined);
  if (detected || !hasTiffHeader(prefix)) return detected;
  return fileTypeFromBuffer(await readTiff()).catch(() => undefined);
}

export async function sniffMediaStream(stream: ReadableStream<Uint8Array>) {
  const body: ReadableStream<Uint8Array> & { fileType?: DetectedType } =
    await fileTypeStream(stream);
  if (body.fileType) return { body, type: body.fileType };

  // The regular streaming detector replays its prefix. Only buffer an
  // unidentified TIFF candidate, enforcing the same cap even for a lying size.
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let checkedHeader = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.length;
      if (!checkedHeader && length >= 4) {
        checkedHeader = true;
        if (!hasTiffHeader(Buffer.concat(chunks, 4)))
          return { body, type: undefined };
      }
      if (length > MAX_UPLOAD_IMAGE_BYTES)
        throw new BadRequestException('File is too large.');
    }
    const bytes = Buffer.concat(chunks, length);
    const type: DetectedType | undefined = await fileTypeFromBuffer(
      bytes
    ).catch(() => undefined);
    return { body: new Blob([bytes]).stream(), type };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Sniffs the real type from the first bytes, applies the per-type size cap
// and streams the rest into storage. Rejections are BadRequestException with
// the same messages the old buffer validation used. `declaredSize` is the
// Content-Length when the sender gave one; it may be absent or wrong, so the
// stream cap is what really enforces the limit
export async function uploadStreamToStorage(
  storage: IUploadProvider,
  webStream: ReadableStream,
  declaredSize: number,
  merchantId: string
) {
  let sniffed: Awaited<ReturnType<typeof sniffMediaStream>>;
  try {
    sniffed = await sniffMediaStream(webStream);
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException('Failed to read file', { cause: err });
  }
  const { type: detected, body: source } = sniffed;
  if (!detected || !UPLOAD_ALLOWED_MIME.has(detected.mime)) {
    await source.cancel();
    throw new BadRequestException('Unsupported file type.');
  }

  const maxSize = getMaxSize(detected.mime);
  if (declaredSize > maxSize) {
    await source.cancel();
    throw new BadRequestException('File is too large.');
  }

  // pipeline (not pipe) so failing the cap also tears down the source
  const body = pipeline(
    Readable.fromWeb(source as any),
    maxSizeStream(maxSize),
    () => {}
  );

  try {
    const uploaded = await storage.uploadStream(
      body,
      detected.mime,
      detected.ext,
      merchantId
    );
    return { ...uploaded, ext: detected.ext };
  } catch (err) {
    // The size cap rejects mid-upload with its own BadRequestException
    body.destroy();
    throw err;
  }
}
