import { getMediaExtension } from './media.upload';

export function browserMediaRole(media: {
  path: string;
  type?: string;
}): 'video' | 'image' | undefined {
  const type = media.type?.toLowerCase();
  const suffix = getMediaExtension(media.path);
  if (
    type === 'video' ||
    type?.startsWith('video/') ||
    ['mp4', 'mov', 'm4v', 'webm'].includes(suffix)
  )
    return 'video';
  if (
    type === 'image' ||
    type?.startsWith('image/') ||
    [
      'jpg',
      'jpeg',
      'png',
      'webp',
      'avif',
      'heic',
      'heif',
      'gif',
      'bmp',
    ].includes(suffix)
  )
    return 'image';
}

export const browserPlatforms = {
  rednote: 'Rednote',
  xiaohongshu: 'Xiaohongshu',
  tiktok: 'TikTok',
  instagram: 'Instagram',
} as const;

export type BrowserPlatform = keyof typeof browserPlatforms;

export function isBrowserPlatform(value: unknown): value is BrowserPlatform {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(browserPlatforms, value)
  );
}

export function isBrowserChannel(identifier?: string) {
  return (
    !!identifier?.startsWith('browser-') &&
    isBrowserPlatform(identifier.slice(8))
  );
}

export type BrowserProvider = 'bitbrowser' | 'adspower' | 'local-chrome';
export type BrowserPublishAction = 'upload-video' | 'upload-note';

export function isBrowserProvider(value: unknown): value is BrowserProvider {
  return value === 'bitbrowser' || value === 'adspower' || value === 'local-chrome';
}

export interface BrowserProfileInput {
  provider: BrowserProvider;
  profileId: string;
  name: string;
  platforms: BrowserPlatform[];
}
