import type { BrowserOccurrenceRef } from './occurrence';
import { revokedBrowserChannel, revokedReasonCode } from './occurrence';
import { randomUUID } from 'node:crypto';
import {
  BrowserProfileInput,
  browserPlatforms,
} from '@gitroom/helpers/utils/browser-publishing';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

@Injectable()
export class BrowserPublishingRepository {
  constructor(private db: PrismaService) {}

  // Serialize operations for one tenant, including first enablement and concurrent unbinds.
  private async lockOrganization(tx: Prisma.TransactionClient, org: string) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Organization" WHERE id = ${org} AND "deletedAt" IS NULL FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('Organization not found');
  }

  // Called with the same organization lock as authorize-start. Persist even a future
  // schedule whose Temporal workflow has not created its occurrence yet.
  private async failRevokedSchedules(
    tx: Prisma.TransactionClient,
    organizationId: string,
    channels: Prisma.Sql
  ) {
    const error = JSON.stringify({
      cause: { type: 'bad_body', failure: { message: revokedBrowserChannel } },
    });
    await tx.$executeRaw`
      WITH revoked AS (
        UPDATE "Post" p SET state='ERROR', error=${error}, "updatedAt"=now(), "browserLocked"=false,
          "browserWorkflowId"=coalesce(p."browserWorkflowId", 'post_' || p.id)
        FROM "Integration" i
        WHERE p."organizationId"=${organizationId} AND i."organizationId"=p."organizationId"
          AND p."integrationId"=i.id AND p."deletedAt" IS NULL AND p."parentPostId" IS NULL
          AND i."browserBindingId" IS NOT NULL AND (${channels})
          AND (
            (p.state='QUEUE' AND NOT p."browserLocked" AND NOT EXISTS (
              SELECT 1 FROM "BrowserPostOccurrence" r WHERE r."workflowId"=p."browserWorkflowId" AND r.status <> 'pending'))
            OR (p.state='ERROR' AND EXISTS (
              SELECT 1 FROM "BrowserPostOccurrence" r WHERE r."workflowId"=p."browserWorkflowId"
              AND r.status IN ('needs_review','unknown') AND r."startedAt" IS NULL AND r."reviewedAt" IS NULL))
          )
        RETURNING p.id, p."browserWorkflowId", coalesce(p."browserDueAt", p."publishDate") AS due
      )
      INSERT INTO "BrowserPostOccurrence" ("workflowId","postId","dueAt",status,"settledAt",reason)
      SELECT "browserWorkflowId", id, due, 'failed', now(), ${revokedReasonCode} FROM revoked
      ON CONFLICT ("workflowId") DO UPDATE SET status='failed', "settledAt"=now(), reason=EXCLUDED.reason,
        "revocationPending"="BrowserPostOccurrence".status IN ('needs_review','unknown')
      WHERE "BrowserPostOccurrence".status IN ('pending','needs_review','unknown')
        AND "BrowserPostOccurrence"."startedAt" IS NULL AND "BrowserPostOccurrence"."reviewedAt" IS NULL`;
  }

  // A reviewed claim no longer has a polling workflow. Keep its callback
  // until Gateway acknowledges it, including across an orchestrator restart.
  pendingRevocations(organizationId?: string) {
    return this.db.$queryRaw<BrowserOccurrenceRef[]>`
      SELECT r."workflowId", r."postId", p."organizationId" FROM "BrowserPostOccurrence" r
      JOIN "Post" p ON p.id=r."postId" WHERE r."revocationPending"
      ${
        organizationId
          ? Prisma.sql`AND p."organizationId"=${organizationId}`
          : Prisma.empty
      }
      ORDER BY r."workflowId" LIMIT 100`;
  }

  acknowledgeRevocation(workflowId: string) {
    return this.db
      .$executeRaw`UPDATE "BrowserPostOccurrence" SET "revocationPending"=false
      WHERE "workflowId"=${workflowId} AND "revocationPending"`;
  }

  setEnabled(organizationId: string, merchantId: string, enabled: boolean) {
    return this.db.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      const member = await tx.userOrganization.findFirst({
        where: {
          organizationId,
          disabled: false,
          user: {
            providerName: 'GENERIC',
            providerId: merchantId,
            activated: true,
            deletedAt: null,
          },
        },
        select: { id: true },
      });
      if (!member)
        throw new NotFoundException(
          'SSO merchant not found in this organization'
        );
      const current = await tx.browserPublishingMerchant.findUnique({
        where: { organizationId },
      });
      if (current && current.merchantId !== merchantId)
        throw new ConflictException(
          'Organization already belongs to another merchant'
        );
      const merchant = await tx.browserPublishingMerchant.upsert({
        where: { organizationId },
        create: { organizationId, merchantId, enabled },
        update: { enabled },
      });
      if (!enabled)
        await this.failRevokedSchedules(tx, organizationId, Prisma.sql`true`);
      return merchant;
    });
  }

  bind(organizationId: string, input: BrowserProfileInput) {
    return this.db.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      const merchant = await tx.browserPublishingMerchant.findUnique({
        where: { organizationId },
      });
      if (!merchant?.enabled)
        throw new ForbiddenException(
          'Browser publishing is disabled for this organization'
        );
      const { provider, profileId, name } = input;
      const binding = await tx.browserProfileBinding.upsert({
        where: {
          organizationId_provider_profileId: {
            organizationId,
            provider,
            profileId,
          },
        },
        create: { organizationId, provider, profileId, name },
        update: { name, active: true },
      });
      const existing = await tx.integration.findMany({
        where: { browserBindingId: binding.id, deletedAt: null },
        select: { id: true, providerIdentifier: true },
      });
      const channels = [];
      for (const platform of input.platforms) {
        const identifier = 'browser-' + platform;
        const data = { name: name + ' · ' + browserPlatforms[platform] };
        const channel = existing.find(
          (row) => row.providerIdentifier === identifier
        );
        const select = {
          id: true,
          name: true,
          providerIdentifier: true,
        } as const;
        channels.push(
          channel
            ? await tx.integration.update({
                where: { id: channel.id },
                data,
                select,
              })
            : await tx.integration.create({
                data: {
                  ...data,
                  organizationId,
                  browserBindingId: binding.id,
                  providerIdentifier: identifier,
                  internalId: 'browser:' + randomUUID(),
                  type: 'social',
                  token: '',
                },
                select,
              })
        );
      }
      // Retire removed accounts. A later binding gets fresh channel IDs, so old schedules stay retired.
      const retired = await tx.integration.updateMany({
        where: {
          browserBindingId: binding.id,
          deletedAt: null,
          id: { notIn: channels.map((row) => row.id) },
        },
        data: { deletedAt: new Date(), disabled: true },
      });
      if (retired.count)
        await this.failRevokedSchedules(
          tx,
          organizationId,
          Prisma.sql`i."browserBindingId"=${binding.id} AND i."deletedAt" IS NOT NULL`
        );
      return { ...binding, channels };
    });
  }

  unbind(organizationId: string, id: string) {
    return this.db.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      const binding = await tx.browserProfileBinding.findFirst({
        where: { id, organizationId },
      });
      if (!binding)
        throw new NotFoundException('Browser profile binding not found');
      await tx.integration.updateMany({
        where: { browserBindingId: id, deletedAt: null },
        data: { deletedAt: new Date(), disabled: true },
      });
      const inactive = await tx.browserProfileBinding.update({
        where: { id },
        data: { active: false },
        select: { id: true, active: true },
      });
      await this.failRevokedSchedules(
        tx,
        organizationId,
        Prisma.sql`i."browserBindingId"=${id}`
      );
      return inactive;
    });
  }
}
