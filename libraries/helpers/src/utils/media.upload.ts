export type StorageProvider = 'local' | 'cloudflare' | 'azure';

// What users may put in the media library, whether by multipart upload or
// from a remote URL; narrower than what storage itself accepts, no audio
export const UPLOAD_EXTENSIONS = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
  ['image/bmp', 'bmp'],
  ['image/tiff', 'tif'],
  ['video/mp4', 'mp4'],
]);

export const MAX_UPLOAD_IMAGE_BYTES = 10 * 1024 ** 2;
export const MAX_UPLOAD_VIDEO_BYTES = 1024 ** 3;

export const uploadPurposes = ['media', 'thumbnail'] as const;
export type UploadPurpose = (typeof uploadPurposes)[number];

export function isUploadPurpose(value: unknown): value is UploadPurpose {
  return uploadPurposes.some((purpose) => value === purpose);
}

export interface AzureUploadRequest {
  name: string;
  contentType: string;
  size: number;
  purpose: UploadPurpose;
}

export function getMediaFilename(path?: string | null) {
  if (!path) return '';
  try {
    // Media records may contain an absolute URL or a local upload path.
    const pathname = new URL(path, 'https://localhost').pathname;
    return pathname.slice(pathname.lastIndexOf('/') + 1);
  } catch {
    return '';
  }
}

export function getMediaExtension(path?: string | null) {
  return /\.([a-z\d]+)$/i.exec(getMediaFilename(path))?.[1].toLowerCase() ?? '';
}

export function isTiffPath(path?: string) {
  const extension = getMediaExtension(path);
  return extension === 'tif' || extension === 'tiff';
}
