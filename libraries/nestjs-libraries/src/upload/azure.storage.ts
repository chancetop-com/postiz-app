import {
  BlobServiceClient,
  BlobSASPermissions,
  SASProtocol,
  type BlockBlobClient,
} from '@azure/storage-blob';
import {
  BadRequestException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { isSafePublicHttpsUrl } from '../dtos/webhooks/webhook.url.validator';
import { ssrfSafeDispatcher } from '../dtos/webhooks/ssrf.safe.dispatcher';
import {
  UPLOAD_ALLOWED_MIME,
  getMaxSize,
  detectMediaType,
  sniffMediaStream,
  MEDIA_SNIFF_BYTES,
} from './custom.upload.validation';
import type { AzureUploadRequest } from '@gitroom/helpers/utils/media.upload';
import { parseDataUrl } from './data.url';
import { IUploadProvider, UploadedStream } from './upload.interface';

// Internal media generators can also write audio.
const storageTypes = new Set([
  ...UPLOAD_ALLOWED_MIME,
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
]);
const { fileTypeFromBuffer } = require('file-type');

function setting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Azure storage requires ${name}`);
  return value;
}

export class AzureBlobStorage implements IUploadProvider {
  private readonly container = BlobServiceClient.fromConnectionString(
    setting('AZURE_CONNECTIONURL')
  ).getContainerClient(setting('AZURE_CONTAINER'));
  private readonly keyPrefix: string;

  constructor() {
    const basePath = process.env.AZURE_BASEPATH?.trim().replace(
      /^\/+|\/+$/g,
      ''
    );
    if (
      basePath &&
      !basePath.split('/').every((part) => /^[\w-]+$/.test(part))
    ) {
      throw new Error('Invalid AZURE_BASEPATH');
    }
    this.keyPrefix = basePath ? basePath + '/' : '';
    if (new URL(this.container.url).protocol !== 'https:') {
      throw new Error('Azure Blob storage requires an HTTPS endpoint');
    }
  }

  // The storage path uses the authenticated Postiz organization ID as merchantId.
  newObjectKey(merchantId: string, extension: string) {
    if (!merchantId || !/^[\w-]+$/.test(merchantId)) {
      throw new Error('Azure uploads require a merchant ID');
    }
    if (!/^[a-z0-9]+$/i.test(extension))
      throw new Error('Invalid media extension');
    return `${this.keyPrefix}${merchantId}/${randomUUID()}.${extension}`;
  }

  blobClient(key: string): BlockBlobClient {
    return this.container.getBlockBlobClient(key);
  }

  private directUploadKey(
    merchantId: string,
    uploadId: string,
    request: AzureUploadRequest,
    extension: string
  ) {
    if (
      !/^[\w-]+$/.test(merchantId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        uploadId
      )
    )
      throw new NotFoundException('Upload not found');
    // Only this key receives a SAS. Changing any grant field at confirmation
    // resolves to a different blob; no reservation or stored grant is needed.
    const identity = JSON.stringify([
      uploadId,
      request.purpose,
      request.name,
      request.contentType,
      request.size,
    ]);
    const stem = createHash('sha256').update(identity).digest('hex');
    return `${this.keyPrefix}${merchantId}/${stem}.${extension}`;
  }

  async createDirectUpload(
    merchantId: string,
    request: AzureUploadRequest,
    extension: string
  ) {
    const uploadId = randomUUID();
    const key = this.directUploadKey(merchantId, uploadId, request, extension);
    const uploadUrl = await this.blobClient(key).generateSasUrl({
      permissions: BlobSASPermissions.parse('c'),
      protocol: SASProtocol.Https,
      expiresOn: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });
    return { uploadId, uploadUrl };
  }

  async confirmDirectUpload(
    merchantId: string,
    uploadId: string,
    request: AzureUploadRequest,
    extension: string
  ) {
    const key = this.directUploadKey(merchantId, uploadId, request, extension);
    const blob = this.blobClient(key);
    try {
      try {
        await this.validateCommittedBlob(blob, request);
      } catch (error) {
        // A concurrent confirmation can normalize the HTTP headers and advance the ETag.
        if ((error as { statusCode?: number }).statusCode !== 412) throw error;
        await this.validateCommittedBlob(blob, request);
      }
      return {
        ...request,
        filename: key.split('/').pop()!,
        path: this.publicUrl(key),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404)
        throw new NotFoundException('Upload not found or not committed.');
      if (status === 412)
        throw new BadRequestException('Upload changed during confirmation.');
      throw new ServiceUnavailableException(
        'Blob storage could not confirm the upload.'
      );
    }
  }

  private async validateCommittedBlob(
    blob: BlockBlobClient,
    request: AzureUploadRequest
  ) {
    const properties = await blob.getProperties();
    const { contentLength, etag, blobType } = properties;
    if (blobType !== 'BlockBlob' || !etag || contentLength !== request.size)
      throw new BadRequestException(
        'The committed blob does not match the requested size.'
      );

    const prefix = await blob.downloadToBuffer(
      0,
      Math.min(contentLength, MEDIA_SNIFF_BYTES),
      {
        conditions: { ifMatch: etag },
      }
    );
    const type = await detectMediaType(prefix, async () => {
      if (contentLength > getMaxSize('image/tiff'))
        throw new BadRequestException('File is too large.');
      return blob.downloadToBuffer(0, contentLength, {
        conditions: { ifMatch: etag },
      });
    });
    if (type?.mime !== request.contentType)
      throw new BadRequestException(
        'The uploaded contents do not match the requested media type.'
      );
    if (
      properties.contentType !== type.mime ||
      properties.contentEncoding ||
      properties.contentDisposition ||
      properties.cacheControl
    ) {
      await blob.setHTTPHeaders(
        { blobContentType: type.mime },
        { conditions: { ifMatch: etag } }
      );
    }
  }

  publicUrl(key: string) {
    const client = key ? this.blobClient(key) : this.container;
    const { origin, pathname } = new URL(client.url);
    return origin + (key ? pathname : pathname.replace(/\/$/, '') + '/');
  }

  async uploadStream(
    stream: Readable,
    mimetype: string,
    ext: string,
    merchantId: string
  ): Promise<UploadedStream> {
    if (!storageTypes.has(mimetype)) throw new Error('Unsupported file type.');
    const key = this.newObjectKey(merchantId, ext);
    const controller = new AbortController();
    try {
      await this.blobClient(key).uploadStream(stream, 5 * 1024 * 1024, 3, {
        blobHTTPHeaders: { blobContentType: mimetype },
        abortSignal: controller.signal,
      });
    } catch (error) {
      // A size limit or disconnected caller can fail the input while blocks
      // are still in flight. Azure only publishes a blob after the final commit.
      controller.abort();
      throw error;
    }
    const filename = key.split('/').pop()!;
    return {
      filename,
      originalname: filename,
      path: this.publicUrl(key),
      mimetype,
    };
  }

  private async uploadBuffer(bytes: Buffer, merchantId: string) {
    const type = await fileTypeFromBuffer(bytes);
    if (!type) throw new Error('Unsupported file type.');
    return this.uploadStream(
      Readable.from([bytes]),
      type.mime,
      type.ext,
      merchantId
    );
  }

  uploadFile(file: Express.Multer.File, merchantId: string) {
    return this.uploadBuffer(file.buffer, merchantId);
  }

  async uploadSimple(path: string, merchantId: string) {
    if (path.startsWith('data:')) {
      const data = parseDataUrl(path);
      if (!data) throw new Error('Invalid data URL');
      return (await this.uploadBuffer(data.buffer, merchantId)).path;
    }
    if (!(await isSafePublicHttpsUrl(path))) throw new Error('Unsafe URL');
    const response = await fetch(path, {
      // @ts-ignore — undici dispatcher is not in lib.dom fetch types
      dispatcher: ssrfSafeDispatcher,
    });
    if (!response.ok || !response.body) throw new Error('Failed to fetch URL');
    const { body: stream, type } = await sniffMediaStream(response.body);
    if (!type || !storageTypes.has(type.mime)) {
      await stream.cancel();
      throw new Error('Unsupported file type.');
    }
    return (
      await this.uploadStream(
        Readable.fromWeb(stream as any),
        type.mime,
        type.ext,
        merchantId
      )
    ).path;
  }

  async removeFile(path: string) {
    const prefix = this.publicUrl('');
    const key = path.startsWith(prefix) ? path.slice(prefix.length) : path;
    if (!key.startsWith(this.keyPrefix)) return;
    const suffix = key.slice(this.keyPrefix.length);
    if (!/^[\w-]+\/[\w-]+\.[a-z0-9]+$/i.test(suffix)) return;
    await this.blobClient(key).deleteIfExists();
  }
}
