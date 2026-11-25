import { getMediaExtension } from './media.upload';

export const hasExtension = (
  path: string | undefined | null,
  extension: string
): boolean => {
  const suffix = getMediaExtension(path);
  return !!suffix && suffix === extension.replace(/^\./, '').toLowerCase();
};
