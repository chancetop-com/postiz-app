import { createHash } from 'node:crypto';
import { UploadFactory } from '../../../upload/upload.factory';
import { AzureBlobStorage } from '../../../upload/azure.storage';
import type { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import {
  browserMediaRole,
  isBrowserPlatform,
} from '@gitroom/helpers/utils/browser-publishing';
import { validateTikTokInstagram } from '@gitroom/helpers/utils/browser-tiktok-instagram';
import { rednoteSettingsError } from '@gitroom/helpers/utils/rednote-settings';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';

export type SelectedBrowserMedia = {
  id?: string;
  path?: string;
  thumbnail?: string;
  alt?: string;
};

function desktopUrl(path: string) {
  const url = /^https?:\/\//i.test(path)
    ? new URL(path)
    : new URL(
        [
          process.env.FRONTEND_URL?.replace(/\/$/, ''),
          process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY?.replace(
            /^\/+|\/+$/g,
            ''
          ),
          path.replace(/^\/+/, ''),
        ]
          .filter(Boolean)
          .join('/')
      );
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new ConflictException('Media does not have a readable upload URL');
  return url.href;
}

// Thumbnail-only uploads are saved on the organization's video without a separate library row.
function storedVideoCover(
  organizationId: string,
  video: { id: string; updatedAt: Date; thumbnail: string | null },
  path: string
) {
  if (video.thumbnail !== path) return;
  const storage = UploadFactory.createStorage();
  const root =
    storage instanceof AzureBlobStorage
      ? storage.organizationUploadRoot(organizationId)
      : storage.publicUrl?.('') ||
        process.env.FRONTEND_URL?.replace(/\/$/, '') + '/uploads/';
  const prefix = root.replace(/\/$/, '') + '/';
  const url = desktopUrl(path);
  if (
    !url.startsWith(prefix) ||
    !/^[\w/-]+\.(?:jpe?g|png|gif|webp|avif|bmp|tiff?|heic|heif)$/i.test(
      url.slice(prefix.length)
    )
  )
    return;
  return { id: video.id, path, type: 'image', fileSize: 0, updatedAt: video.updatedAt };
}

export async function browserPublishContent(
  db: Pick<Prisma.TransactionClient, 'media'>,
  organizationId: string,
  identifier: string,
  content: string,
  settings: Record<string, unknown>,
  selected: SelectedBrowserMedia[]
) {
  const platform = identifier.slice('browser-'.length);
  if (!identifier.startsWith('browser-') || !isBrowserPlatform(platform))
    throw new ConflictException('Unsupported browser channel');
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    selected.some((item) => !item || typeof item.id !== 'string' || !item.id)
  ) {
    throw new ConflictException(
      'Select media from this organization’s library'
    );
  }
  const ids = selected.map((item) => item.id!);
  const covers = selected.flatMap((item) =>
    item.thumbnail ? [item.thumbnail] : []
  );
  const library = await db.media.findMany({
    where: {
      organizationId,
      deletedAt: null,
      OR: [{ id: { in: ids } }, { path: { in: covers } }],
    },
    select: {
      id: true,
      path: true,
      type: true,
      fileSize: true,
      updatedAt: true,
      thumbnail: true,
    },
  });
  const byId = new Map(library.map((item) => [item.id, item]));
  const byPath = new Map(library.map((item) => [item.path, item]));
  const rows = selected.flatMap((item) => {
    const file = byId.get(item.id!);
    if (!file)
      throw new ConflictException('The selected media is no longer available');
    const role = browserMediaRole(file);
    if (!role)
      throw new ConflictException('Select a video or images for this post');
    const rows: {
      id: string;
      path: string;
      updatedAt: Date;
      type: string;
      size: number;
      role: 'image' | 'video' | 'cover';
      alt?: string;
    }[] = [
      {
        id: file.id,
        path: file.path,
        updatedAt: file.updatedAt,
        type: file.type,
        size: file.fileSize,
        role,
        alt: item.alt,
      },
    ];
    if (item.thumbnail) {
      if (role !== 'video')
        throw new ConflictException('Only a video can have a separate cover');
      const cover =
        byPath.get(item.thumbnail) ||
        storedVideoCover(organizationId, file, item.thumbnail);
      if (!cover || browserMediaRole(cover) !== 'image')
        throw new ConflictException(
          'Select an available image as the video cover'
        );
      rows.push({
        id: cover.id,
        path: cover.path,
        updatedAt: cover.updatedAt,
        type: cover.type,
        size: cover.fileSize,
        role: 'cover',
      });
    }
    return rows;
  });
  const action = rows.some((row) => row.role === 'video')
    ? 'upload-video'
    : 'upload-note';
  if (action === 'upload-video' && selected.length !== 1)
    throw new ConflictException(
      'Select one video or an ordered list of images'
    );
  const caption = stripHtmlValidation(
    'normal',
    content,
    true,
    false,
    !/<\/?[a-z][\s\S]*>/i.test(content)
  );
  // The media settings panel authors shared alt text. A channel override follows its own image order.
  let publishSettings = settings;
  if (
    platform === 'instagram' &&
    action === 'upload-note' &&
    !('altText' in settings) &&
    rows.some((row) => row.alt)
  ) {
    publishSettings = {
      ...settings,
      altText: rows.map((row) => row.alt || ''),
    };
  }
  const error =
    platform === 'rednote' || platform === 'xiaohongshu'
      ? rednoteSettingsError(settings)
      : validateTikTokInstagram(
          platform,
          action,
          publishSettings,
          caption,
          rows
        );
  if (error) throw new ConflictException(error);
  const media = rows.map(({ id, path, role, updatedAt }) => {
    const url = new URL(desktopUrl(path));
    const revision = updatedAt.toISOString();
    // Fragments version the desktop cache without changing the origin request or signed query.
    url.hash = 'sau-media-' + createHash('sha256').update(JSON.stringify([id, revision])).digest('hex');
    return { id, url: url.href, role };
  });
  return { platform, action, caption, media, settings: publishSettings } as const;
}
