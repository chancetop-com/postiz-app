import {
  UploadPartCommand,
  S3Client,
  ListPartsCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import path from 'path';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fileTypeFromBuffer } = require('file-type');

const ALLOWED_EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
};

// Multipart uploads go through the normalizer, so they may also carry
// QuickTime, which it turns into an mp4; simple uploads never do
function multipartExtToMime(): Record<string, string> {
  return {
    ...ALLOWED_EXT_TO_MIME,
    ...(UploadFactory.processorEnabled() ? { '.mov': 'video/quicktime' } : {}),
  };
}

function normalizeExtension(filename: string): string | null {
  const ext = path.extname(filename || '').toLowerCase();
  return multipartExtToMime()[ext] ? ext : null;
}

const {
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_ACCESS_KEY,
  CLOUDFLARE_SECRET_ACCESS_KEY,
  CLOUDFLARE_BUCKETNAME,
  CLOUDFLARE_BUCKET_URL,
} = process.env;

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: CLOUDFLARE_ACCESS_KEY!,
    secretAccessKey: CLOUDFLARE_SECRET_ACCESS_KEY!,
  },
});

// Function to generate a random string
function generateRandomString() {
  return makeId(20);
}

function multipartSignature(org: string, key: string, uploadId: string) {
  return createHmac('sha256', process.env.JWT_SECRET!)
    .update(JSON.stringify(['r2-multipart', org, key, uploadId]))
    .digest('base64url');
}

// Uppy carries one opaque token across all multipart steps. R2 receives the
// underlying session ID only after Postiz verifies the current organization.
export function verifyMultipartUploadId(
  org: string,
  key: string,
  token: string
) {
  if (typeof key !== 'string' || typeof token !== 'string' || !token)
    throw new BadRequestException('Missing multipart upload identity.');
  const separator = token.indexOf('.');
  if (!/^r2-[0-9a-f-]{36}\.[a-z0-9]+$/.test(key) || separator < 1)
    throw new NotFoundException('Multipart upload not found.');
  const uploadId = token.slice(separator + 1);
  const supplied = Buffer.from(token.slice(0, separator));
  const expected = Buffer.from(multipartSignature(org, key, uploadId));
  if (
    !uploadId ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw new NotFoundException('Multipart upload not found.');
  return uploadId;
}

export function signMultipartUploadId(
  org: string,
  key: string,
  uploadId: string
) {
  return multipartSignature(org, key, uploadId) + '.' + uploadId;
}

export async function simpleUpload(
  data: Buffer,
  originalFilename: string,
  _contentType: string
) {
  const detected = await fileTypeFromBuffer(data);
  if (
    !detected ||
    !Object.values(ALLOWED_EXT_TO_MIME).includes(detected.mime)
  ) {
    throw new Error('Unsupported file type.');
  }
  const fileExtension = `.${detected.ext}`;
  const safeContentType = detected.mime;
  const randomFilename = generateRandomString() + fileExtension;

  const params = {
    Bucket: CLOUDFLARE_BUCKETNAME,
    Key: randomFilename,
    Body: data,
    ContentType: safeContentType,
  };

  const command = new PutObjectCommand({ ...params });
  await R2.send(command);

  return CLOUDFLARE_BUCKET_URL + '/' + randomFilename;
}

export async function createMultipartUpload(
  filename: string,
  fileHash: string
) {
  const safeExt = normalizeExtension(filename);
  if (!safeExt) {
    throw new BadRequestException('Unsupported file type.');
  }
  const safeContentType = multipartExtToMime()[safeExt];
  const randomFilename = 'r2-' + randomUUID() + safeExt;

  const command = new CreateMultipartUploadCommand({
    Bucket: CLOUDFLARE_BUCKETNAME,
    Key: randomFilename,
    ContentType: safeContentType,
    Metadata: {
      'x-amz-meta-file-hash': fileHash,
    },
  });
  const { UploadId } = await R2.send(command);
  if (!UploadId) throw new Error('R2 did not return a multipart upload ID.');
  return { key: randomFilename, uploadId: UploadId };
}

export async function prepareUploadParts(
  key: string,
  uploadId: string,
  parts: { number: number }[]
) {
  const presignedUrls: Record<number, string> = {};
  for (const part of parts) {
    const { url } = await signPart(key, uploadId, part.number);
    presignedUrls[part.number] = url;
  }
  return { presignedUrls };
}

export async function listParts(key: string, uploadId: string) {
  const { Parts } = await R2.send(
    new ListPartsCommand({
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: key,
      UploadId: uploadId,
    })
  );
  return Parts || [];
}

async function validateMultipartObject(key: string) {
  const safeExt = normalizeExtension(key || '');
  if (!safeExt) {
    await R2.send(
      new DeleteObjectCommand({ Bucket: CLOUDFLARE_BUCKETNAME, Key: key })
    );
    throw new BadRequestException('Unsupported file type.');
  }
  const expectedMime = multipartExtToMime()[safeExt];

  const head = await R2.send(
    new GetObjectCommand({
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: key,
      Range: 'bytes=0-4100',
    })
  );
  const chunks: Buffer[] = [];
  // @ts-ignore
  for await (const chunk of head.Body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const prefix = Buffer.concat(chunks);
  const detected = await fileTypeFromBuffer(prefix);

  // .mov and .mp4 are the same ISO BMFF family: a .mov with an ISO brand
  // sniffs as video/mp4 and a QuickTime-brand file is often named .mp4.
  // The normalizer reads both and always writes an mp4, so accept both
  // for either extension whenever it is on; without it .mp4 stays strict.
  const acceptedMimes =
    UploadFactory.processorEnabled() &&
    (safeExt === '.mov' || safeExt === '.mp4')
      ? ['video/quicktime', 'video/mp4']
      : [expectedMime];
  if (!detected || !acceptedMimes.includes(detected.mime)) {
    await R2.send(
      new DeleteObjectCommand({ Bucket: CLOUDFLARE_BUCKETNAME, Key: key })
    );
    throw new BadRequestException('File contents do not match declared type.');
  }
}

export interface MultipartOperation {
  key?: string;
  uploadId?: string;
  file?: { name?: string };
  fileHash?: string;
  partNumber?: number | string;
  partData?: { key: string; uploadId: string; parts: { number: number }[] };
}

export interface MultipartCompletion {
  key: string;
  uploadId: string;
  parts: CompletedPart[];
  file?: { name?: string };
  retry?: boolean;
}

export async function completeMultipartUpload(
  request: MultipartCompletion,
  uploadId: string
) {
  const { key, parts } = request;
  const Location = process.env.CLOUDFLARE_BUCKET_URL + '/' + key;
  if (request.retry === true) {
    // The preceding command may have committed even if its HTTP response or
    // subsequent registration failed. Only a grant signed for this exact
    // organization, object and R2 session can adopt the committed bytes.
    try {
      await validateMultipartObject(key);
      return { Key: key, Location };
    } catch (error) {
      if (!isR2NotFound(error)) throw error;
    }
  }

  let response;
  try {
    response = await R2.send(
      new CompleteMultipartUploadCommand({
        Bucket: CLOUDFLARE_BUCKETNAME,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      })
    );
  } catch (error) {
    // An overlapping request can consume the ID before this command arrives.
    if (!isR2NotFound(error)) throw error;
  }
  await validateMultipartObject(key);
  return { ...response, Key: key, Location };
}

function isR2NotFound(error: unknown) {
  return (
    (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode === 404
  );
}

export function abortMultipartUpload(key: string, uploadId: string) {
  return R2.send(
    new AbortMultipartUploadCommand({
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: key,
      UploadId: uploadId,
    })
  );
}

export async function signPart(
  key: string,
  uploadId: string,
  partNumber: number
) {
  const params = {
    Bucket: CLOUDFLARE_BUCKETNAME,
    Key: key,
    PartNumber: partNumber,
    UploadId: uploadId,
    Expires: 3600,
  };

  const command = new UploadPartCommand({ ...params });
  const url = await getSignedUrl(R2, command, { expiresIn: 3600 });

  return { url };
}
