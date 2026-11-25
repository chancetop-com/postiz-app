import sharp from 'sharp';
import { getSsrfSafeAxios } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { isPublishImageProcessingEnabled } from '@gitroom/nestjs-libraries/integrations/publish-image-processing';
import {
  BadBody,
  type ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

const maxPhotoSize = 20 * 1024 * 1024;

function invalidPhoto(message: string): never {
  throw new BadBody('tiktok', '{}', '{}', message);
}

// libvips needs the whole RIFF container even to read WebP dimensions.
// The canvas is in the first VP8, VP8L or VP8X chunk of standard WebP files.
// https://developers.google.com/speed/webp/docs/riff_container
function webpDimensions(bytes: Buffer, total: number) {
  if (
    bytes.length < 30 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP' ||
    bytes.readUInt32LE(4) + 8 !== total
  )
    return;
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && bytes.readUInt32LE(16) === 10) {
    return {
      format: 'webp',
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const dimensions = bytes.readUInt32LE(21);
    return {
      format: 'webp',
      width: 1 + (dimensions & 0x3fff),
      height: 1 + ((dimensions >>> 14) & 0x3fff),
    };
  }
  if (chunk === 'VP8 ' && bytes.readUIntBE(23, 3) === 0x9d012a) {
    return {
      format: 'webp',
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
}

// TikTok pulls the original URL for compatible photos. A short range normally
// contains all the metadata needed to validate those photos before publishing.
export async function prepareTikTokPhoto(
  url: string,
  createPublishCopy: boolean
): Promise<Buffer | undefined> {
  const read = async (range?: string) => {
    try {
      return await getSsrfSafeAxios().get<Buffer>(url, {
        responseType: 'arraybuffer',
        headers: range
          ? { Range: range, 'Accept-Encoding': 'identity' }
          : undefined,
        maxContentLength: maxPhotoSize,
        timeout: 30_000,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('maxContentLength')
      ) {
        invalidPhoto('TikTok photos must be 20 MiB or smaller.');
      }
      throw error;
    }
  };
  const response = await read('bytes=0-65535');
  let bytes = Buffer.from(response.data);
  const total = Number(String(response.headers['content-range']).split('/')[1]);
  if (total > maxPhotoSize || bytes.length > maxPhotoSize) {
    invalidPhoto('TikTok photos must be 20 MiB or smaller.');
  }
  let partial = response.status === 206 && bytes.length !== total;
  let metadata =
    (partial && webpDimensions(bytes, total)) ||
    (await sharp(bytes)
      .metadata()
      .catch(() => undefined));
  if (partial && (!metadata || !Number.isFinite(total))) {
    // JPEGs with long EXIF headers can place dimensions beyond the first range.
    bytes = Buffer.from((await read()).data);
    partial = false;
    metadata = await sharp(bytes)
      .metadata()
      .catch(() => undefined);
  }
  if (!metadata)
    invalidPhoto('Unreadable TikTok photo. Select a JPEG or WebP image.');
  if (Math.min(metadata.width, metadata.height) > 1080) {
    invalidPhoto(
      `Image is ${metadata.width}x${metadata.height}. TikTok allows a maximum of 1080px on the shorter side.`
    );
  }
  if (metadata.format === 'jpeg' || metadata.format === 'webp') return;
  if (metadata.format !== 'png' || !isPublishImageProcessingEnabled()) {
    invalidPhoto(
      `TikTok cannot publish this ${metadata.format.toUpperCase()} photo. Select a JPEG or WebP image.`
    );
  }

  if (!createPublishCopy) return;
  if (partial) bytes = Buffer.from((await read()).data);
  const jpeg = await sharp(bytes).jpeg({ quality: 100 }).toBuffer();
  if (jpeg.length > maxPhotoSize)
    invalidPhoto('The TikTok JPEG exceeds 20 MiB.');
  return jpeg;
}

export async function validateTikTokPhotos(
  items: ValidityMedia[]
): Promise<true | string> {
  const problems = await Promise.all(
    items.map(async ({ path }, index) => {
      const url = /^https?:\/\//.test(path)
        ? path
        : process.env.FRONTEND_URL + '/' + path;
      try {
        await prepareTikTokPhoto(url, false);
      } catch (error) {
        return `Image ${index + 1}. ${
          error instanceof Error ? error.message : 'Could not read photo.'
        }`;
      }
    })
  );
  return problems.find(Boolean) || true;
}
