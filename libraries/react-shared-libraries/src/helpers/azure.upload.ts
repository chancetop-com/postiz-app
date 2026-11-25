import { BasePlugin, type Uppy, type UppyFile } from '@uppy/core';
import {
  recoverUploadCompletion,
  UploadHttpError,
  uploadJson,
} from './upload.completion';

import type {
  AzureUploadRequest,
  UploadPurpose,
} from '@gitroom/helpers/utils/media.upload';

type SessionFetch = (path: string, options: RequestInit) => Promise<Response>;
type PathResult = { path: string };
interface SavedMedia extends PathResult {
  id: string;
  name: string;
  originalName: string | null;
  thumbnail: string | null;
  alt: string | null;
  status: string;
}
export type UploadResult<P extends UploadPurpose> = P extends 'media'
  ? SavedMedia
  : PathResult;

interface UploadOptions {
  fallbackContentType?: string;
  onProgress?: (bytes: number) => void;
  signal?: AbortSignal;
}

const blockSize = 5 * 1024 * 1024;

export async function uploadAzureMedia<P extends UploadPurpose>(
  fetch: SessionFetch,
  file: Blob,
  name: string,
  purpose: P,
  options: UploadOptions = {}
): Promise<UploadResult<P>> {
  const contentType = file.type || options.fallbackContentType || '';
  const post = (path: string, body: unknown) =>
    fetch('/media/azure/uploads' + path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: options.signal,
    });
  const request: AzureUploadRequest = {
    name,
    size: file.size,
    contentType,
    purpose,
  };
  const grant = await post('', request);
  if (!grant.ok) throw new Error('Could not authorize the media upload.');
  const { uploadId, uploadUrl } = await grant.json();
  const { BlockBlobClient } = await import('@azure/storage-blob');
  const blob = new BlockBlobClient(uploadUrl);
  let uploadError: unknown;
  try {
    await blob.uploadData(file, {
      blockSize,
      maxSingleShotSize: blockSize,
      abortSignal: options.signal,
      blobHTTPHeaders: { blobContentType: contentType },
      onProgress: (event) => options.onProgress?.(event.loadedBytes),
    });
  } catch (error) {
    // A lost PUT response can make the SDK retry a write that already committed.
    // With a create-only SAS that retry is refused. Confirmation checks the actual blob.
    if (options.signal?.aborted) throw error;
    uploadError = error;
  }
  // Retry a lost confirmation response with the same authority. Issuing a
  // second grant here would create a different media record.
  const confirm = async () =>
    uploadJson(
      await post('/' + encodeURIComponent(uploadId) + '/confirm', request),
      'Could not confirm the uploaded media.'
    );
  try {
    return await recoverUploadCompletion(confirm, confirm, options.signal);
  } catch (error) {
    if (error instanceof UploadHttpError && uploadError) throw uploadError;
    throw error;
  }
}

type AzureFile = UppyFile<any, any>;
export class AzureUppyUpload extends BasePlugin<
  { id?: string; fetch: SessionFetch },
  any,
  any
> {
  private active = new Map<string, AbortController>();

  constructor(uppy: Uppy<any, any>, options: { fetch: SessionFetch }) {
    super(uppy, options);
    this.id = 'AzureBlobUpload';
    this.type = 'uploader';
  }

  install() {
    this.uppy.addUploader(this.upload);
    this.uppy.on('file-removed', this.cancel);
  }

  uninstall() {
    this.uppy.removeUploader(this.upload);
    this.uppy.off('file-removed', this.cancel);
    for (const controller of this.active.values()) controller.abort();
  }

  private cancel = (file: AzureFile) => this.active.get(file.id)?.abort();

  private upload = async (ids: string[]) => {
    const files = ids.map((id) => this.uppy.getFile(id)).filter(Boolean);
    this.uppy.emit('upload-start', files);
    await Promise.all(files.map((file) => this.uploadFile(file)));
  };

  private async uploadFile(file: AzureFile) {
    const controller = new AbortController();
    this.active.set(file.id, controller);
    try {
      const saved = await uploadAzureMedia(
        this.opts.fetch,
        file.data as Blob,
        file.name,
        'media',
        {
          fallbackContentType: file.type,
          signal: controller.signal,
          onProgress: (bytesUploaded) => {
            const current = this.uppy.getFile(file.id);
            if (current)
              this.uppy.emit('upload-progress', current, {
                uploadStarted: current.progress.uploadStarted ?? 0,
                bytesUploaded,
                bytesTotal: file.data.size,
              });
          },
        }
      );
      if (this.uppy.getFile(file.id))
        this.uppy.emit('upload-success', file, {
          status: 201,
          body: { saved, Location: saved.path },
          uploadURL: saved.path,
        });
    } catch (error) {
      if (!controller.signal.aborted && this.uppy.getFile(file.id))
        this.uppy.emit(
          'upload-error',
          file,
          error instanceof Error ? error : new Error('Upload failed.')
        );
    } finally {
      this.active.delete(file.id);
    }
  }
}
