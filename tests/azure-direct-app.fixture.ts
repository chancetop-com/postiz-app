import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import { vi } from 'vitest';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { startDirectBlobOrigin } from './azure-direct-blob.fixture';

export async function startDirectUploadApp(
  blobOptions?: Parameters<typeof startDirectBlobOrigin>[0],
  provider: 'azure' | 'cloudflare' = 'azure',
  getTemporalClient: () => unknown = () => null
) {
  const merchantId = randomUUID();
  const otherMerchantId = randomUUID();
  const databaseUrl = process.env.AZURE_CONFIRM_TEST_DATABASE_URL;
  const db = databaseUrl
    ? new PrismaClient({ datasourceUrl: databaseUrl })
    : undefined;
  const sessions: Record<string, string> = {};

  const origin = await startDirectBlobOrigin(blobOptions);
  const originUrl = origin.url;
  vi.stubEnv('STORAGE_PROVIDER', provider);
  vi.stubEnv(
    'AZURE_CONNECTIONURL',
    `DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=${Buffer.alloc(
      32,
      1
    ).toString('base64')};BlobEndpoint=${originUrl}`
  );
  vi.stubEnv('AZURE_BASEPATH', 'dev');
  vi.stubEnv('AZURE_CONTAINER', 'postiz');
  vi.stubEnv('JWT_SECRET', 'local-azure-session-test');
  const { Test } = await import('@nestjs/testing');
  const { MediaController } = await import(
    '@gitroom/backend/api/routes/media.controller'
  );
  const { AuthMiddleware } = await import(
    '@gitroom/backend/services/auth/auth.middleware'
  );
  const { MediaService } = await import(
    '@gitroom/nestjs-libraries/database/prisma/media/media.service'
  );
  const { MediaRepository } = await import(
    '@gitroom/nestjs-libraries/database/prisma/media/media.repository'
  );
  const users = [merchantId, otherMerchantId].map((id, i) => ({
    id,
    activated: true,
    email: id + '@example.test',
    providerName: i ? 'GENERIC' : 'LOCAL',
  }));
  for (const user of users) sessions[user.id] = AuthService.signJWT(user);
  if (db)
    await db.organization.createMany({
      data: users.map(({ id }) => ({ id, name: id })),
    });
  const media = new MediaService(
    new MediaRepository({ model: db } as any),
    {} as any,
    {} as any,
    {} as any,
    { client: { getRawClient: getTemporalClient } } as any
  );
  const mod = await Test.createTestingModule({
    controllers: [MediaController],
    providers: [{ provide: MediaService, useValue: media }],
  })
    .useMocker(() => ({}))
    .compile();
  const app = mod.createNestApplication({ logger: false });
  app.use(
    '/azure-test-page',
    (_req: unknown, res: import('express').Response) =>
      res.type('html').send('<!doctype html><body></body>')
  );
  app.use(cookieParser());
  const auth = new AuthMiddleware(
    {
      getOrgsByUserId: async (id: string) => [
        { id, apiKey: 'configured', users: [{ disabled: false }] },
      ],
    } as any,
    {
      getUserById: async (id: string) => users.find((user) => user.id === id),
    } as any
  );
  app.use(auth.use.bind(auth));
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();

  async function close() {
    await app?.close();
    await origin?.close();
    if (db) {
      const merchantIds = { in: [merchantId, otherMerchantId] };
      await db.media.deleteMany({ where: { organizationId: merchantIds } });
      await db.organization.deleteMany({ where: { id: merchantIds } });
      await db.$disconnect();
    }
    vi.unstubAllEnvs();
  }

  function post(endpoint: string, data: unknown, org = merchantId) {
    return fetch(baseUrl + '/media/azure/uploads' + endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        auth: sessions[org],
        showorg: org,
      },
      body: JSON.stringify(data),
    });
  }
  async function library() {
    return (
      await fetch(baseUrl + '/media?page=1', {
        headers: { auth: sessions[merchantId], showorg: merchantId },
      })
    ).json();
  }

  return {
    baseUrl,
    merchantId,
    otherMerchantId,
    sessions,
    db,
    origin,
    library,
    post,
    close,
  };
}
