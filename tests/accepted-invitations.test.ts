import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';

describe.skipIf(!process.env.DATABASE_URL)(
  'accepted organization invitations',
  () => {
    const schema = 'invite_test_' + randomUUID().replaceAll('-', '');
    const admin = new PrismaClient();
    let created = false;
    let db: PrismaClient;
    let repo: OrganizationRepository;

    beforeAll(async () => {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      created = true;
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set('schema', schema);
      execFileSync(
        'pnpm',
        [
          'exec',
          'prisma',
          'db',
          'push',
          '--skip-generate',
          '--schema',
          'libraries/nestjs-libraries/src/database/prisma/schema.prisma',
        ],
        {
          env: { ...process.env, DATABASE_URL: url.toString() },
          stdio: 'pipe',
        }
      );
      db = new PrismaClient({ datasourceUrl: url.toString() });
      const repository = { model: db } as never;
      repo = new OrganizationRepository(repository, repository, repository);
      await db.organization.createMany({
        data: ['personal', 'first', 'second'].map((id) => ({ id, name: id })),
      });
    }, 30000);

    afterAll(async () => {
      await db?.$disconnect();
      if (created)
        await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.$disconnect();
    });

    it('retains both acceptance receipts across changes to membership', async () => {
      const user = await db.user.create({
        data: {
          email: 'invited@example.test',
          providerName: 'LOCAL',
          timezone: 0,
        },
      });
      await repo.addUserToOrg(user.id, 'one', 'first', 'USER');
      await repo.addUserToOrg(user.id, 'two', 'second', 'ADMIN');
      expect(await repo.activationInvitation(user.id, 'two')).toEqual({
        addedOrg: { organizationId: 'second' },
      });
      await db.userOrganization.delete({
        where: {
          userId_organizationId: { userId: user.id, organizationId: 'first' },
        },
      });
      await db.userOrganization.updateMany({
        where: { userId: user.id },
        data: { disabled: true },
      });
      expect(await repo.addUserToOrg(user.id, 'one', 'first', 'USER')).toBe(
        false
      );
      expect(await repo.activationInvitation(user.id, 'two')).toEqual({
        addedOrg: false,
      });
      expect(
        await db.acceptedOrganizationInvite.count({
          where: { userId: user.id },
        })
      ).toBe(2);
    });

    it('offers only active choices for a pre-upgrade account without a recorded target', async () => {
      const user = await db.user.create({
        data: {
          email: 'legacy@example.test',
          providerName: 'LOCAL',
          timezone: 0,
          inviteId: 'legacy',
          organizations: {
            create: ['personal', 'first', 'second'].map((organizationId) => ({
              organizationId,
              disabled: organizationId === 'second',
            })),
          },
        },
      });
      const result = await repo.activationInvitation(user.id, 'legacy');
      expect(result.addedOrg).toBe(false);
      expect(result.organizations?.map(({ id }) => id).sort()).toEqual([
        'first',
        'personal',
      ]);
    });
  }
);
