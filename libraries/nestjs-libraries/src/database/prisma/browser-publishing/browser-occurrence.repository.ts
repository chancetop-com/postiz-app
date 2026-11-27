import { isBrowserProvider } from '@gitroom/helpers/utils/browser-publishing';
import { randomUUID } from 'node:crypto';
import { occurrenceTiming, type BrowserTiming } from './timing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Injectable,
  HttpException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { browserTargetAllowed } from './channel-access';
import { browserPublishContent } from './browser-publish-content';
import { PrismaService } from '../prisma.service';
import {
  browserClaimDeadline,
  browserReasonMessage,
  isRevokedReason,
  revokedBrowserChannel,
} from './occurrence';
import type {
  BrowserOccurrenceRef,
  BrowserStartRef,
  BrowserOutcome,
  BrowserPublishTask,
} from './occurrence';

export class BrowserChannelRevoked extends ForbiddenException {
  constructor() {
    super(revokedBrowserChannel);
  }
}

@Injectable()
export class BrowserOccurrenceRepository {
  constructor(private db: PrismaService) {}

  private async lockPost(
    tx: Prisma.TransactionClient,
    ref: BrowserOccurrenceRef
  ) {
    await tx.$queryRaw`SELECT id FROM "Post" WHERE id = ${ref.postId}
      AND "organizationId" = ${ref.organizationId} FOR UPDATE`;
    return tx.post.findUnique({
      where: {
        id: ref.postId,
        organizationId: ref.organizationId,
        deletedAt: null,
      },
      include: {
        integration: {
          include: { browserBinding: { include: { merchant: true } } },
        },
      },
    });
  }

  async schedule(ref: BrowserOccurrenceRef) {
    return this.db.$transaction(async (tx) => {
      const post = await this.lockPost(tx, ref);
      if (!post || post.state !== 'QUEUE' || !post.integration.browserBindingId)
        return null;
      const dueAt = post.browserDueAt || post.publishDate;
      if (
        post.browserWorkflowId !== ref.workflowId &&
        (post.browserWorkflowId || ref.workflowId !== 'post_' + post.id)
      )
        return null;
      if (!post.browserClaimDeadlineAt || !post.browserWorkflowId) {
        // Upgrade already queued posts, anchored to their original due time.
        await tx.post.update({
          where: { id: post.id },
          data: {
            browserWorkflowId: ref.workflowId,
            browserDueAt: dueAt,
            browserClaimDeadlineAt:
              post.browserClaimDeadlineAt || browserClaimDeadline(dueAt),
          },
        });
      }
      await tx.browserPostOccurrence.upsert({
        where: { workflowId: ref.workflowId },
        update: {},
        create: {
          workflowId: ref.workflowId,
          postId: post.id,
          dueAt,
          timing: { ...occurrenceTiming(dueAt, post.browserImmediate) },
        },
      });
      return dueAt.toISOString();
    });
  }

  async timing(ref: BrowserOccurrenceRef): Promise<BrowserTiming | null> {
    const run = await this.db.browserPostOccurrence.findFirst({
      where: {
        workflowId: ref.workflowId,
        postId: ref.postId,
        post: {
          organizationId: ref.organizationId,
          browserWorkflowId: ref.workflowId,
          deletedAt: null,
        },
      },
      select: { dueAt: true, timing: true },
    });
    // Older scheduled occurrences retain their original due-time upload boundary.
    return run
      ? (run.timing as unknown as BrowserTiming) ?? {
          ...occurrenceTiming(run.dueAt, true),
          prepareAt: null,
          uploadAt: run.dueAt.toISOString(),
        }
      : null;
  }

  async pickupExpired(ref: BrowserOccurrenceRef) {
    const [row] = await this.db.$queryRaw<{ expired: boolean }[]>`
      SELECT coalesce("browserClaimDeadlineAt", coalesce("browserDueAt", "publishDate")
        + interval '30 minutes') <= (clock_timestamp() AT TIME ZONE 'UTC') AS expired
      FROM "Post" WHERE id=${ref.postId} AND "organizationId"=${ref.organizationId}
        AND "browserWorkflowId"=${ref.workflowId}`;
    return row?.expired === true;
  }

  async task(
    ref: BrowserStartRef,
    start: boolean,
    preparing = false
  ): Promise<BrowserPublishTask> {
    return this.db.$transaction(async (tx) => {
      // bind, unbind and enable/disable also lock the parent organization first.
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${ref.organizationId} FOR UPDATE`;
      const post = await this.lockPost(tx, ref);
      const run = await tx.browserPostOccurrence.findUnique({
        where: { workflowId: ref.workflowId },
      });
      if (
        post?.browserWorkflowId === ref.workflowId &&
        run?.postId === post.id &&
        run.status === 'failed' &&
        isRevokedReason(run.reason)
      ) {
        throw new BrowserChannelRevoked();
      }
      if (
        !post ||
        post.browserWorkflowId !== ref.workflowId ||
        post.state !== 'QUEUE' ||
        !run ||
        run.postId !== post.id ||
        run.status !== 'pending'
      ) {
        throw new ConflictException(
          'This scheduled occurrence is no longer ready'
        );
      }
      const timing = run.timing as unknown as BrowserTiming | null;
      if (
        !preparing &&
        Date.parse(timing?.uploadAt || run.dueAt.toISOString()) > Date.now()
      ) {
        // An early or misrouted request cannot lock or fail a still-editable post.
        throw new HttpException('Upload lead window has not opened', 425);
      }
      const channel = post.integration;
      const binding = channel.browserBinding;
      if (
        !binding?.active ||
        !isBrowserProvider(binding.provider) ||
        !binding.merchant.enabled ||
        channel.organizationId !== ref.organizationId ||
        channel.deletedAt ||
        channel.disabled ||
        channel.refreshNeeded
      ) {
        throw new BrowserChannelRevoked();
      }
      const {
        __type,
        noPublish = false,
        ...settings
      } = JSON.parse(post.settings || '{}');
      if (
        !browserTargetAllowed(
          binding.provider,
          noPublish,
          process.env.BROWSER_PUBLISHING_DEV_TEST_TARGETS === 'true'
        )
      ) {
        throw new ForbiddenException('Development browser target is disabled');
      }
      const {
        platform,
        action,
        caption,
        media,
        settings: publishSettings,
      } = await browserPublishContent(
        tx,
        ref.organizationId,
        channel.providerIdentifier,
        post.content,
        settings,
        JSON.parse(post.image || '[]')
      );
      const task: BrowserPublishTask = {
        workflowId: ref.workflowId,
        organizationId: ref.organizationId,
        postId: ref.postId,
        contractVersion: 1,
        requiredCapability: `${platform}.${action}`,
        release: process.env.SAU_REQUIRED_RELEASE || '0.1.0',
        channelId: channel.id,
        bindingId: binding.id,
        profileId: binding.profileId,
        provider: binding.provider,
        platform,
        action,
        caption,
        settings: publishSettings,
        media,
        noPublish,
        claimDeadlineAt: (
          post.browserClaimDeadlineAt || new Date(run.dueAt.getTime() + 1800000)
        ).toISOString(),
        earliestPublishAt: post.browserImmediate
          ? null
          : new Date(Math.ceil(run.dueAt.getTime() / 1000) * 1000)
              .toISOString()
              .replace('.000Z', 'Z'),
      };
      if (start) {
        const prepared = ref.preparedMedia;
        if (
          !Array.isArray(prepared) ||
          prepared.length !== task.media.length ||
          !task.media.every((item, i) =>
            item.id === prepared[i]?.id &&
            item.role === prepared[i].role &&
            item.url === prepared[i].url
          )
        ) {
          // This response carries an editable manifest. Only a matching subsequent
          // request may cross the upload boundary while these rows are locked.
          throw new HttpException({ task }, 412);
        }
        if (ref.mediaFailed) {
          throw new ConflictException('The desktop could not download the selected media');
        }

        await tx.post.update({
          where: { id: post.id },
          data: { browserLocked: true },
        });
        await tx.browserPostOccurrence.update({
          where: { workflowId: ref.workflowId },
          data: {
            status: 'publishing',
            startedAt: new Date(),
            resultDeadlineAt:
              run.resultDeadlineAt ??
              (ref.resultDeadlineAt
                ? new Date(ref.resultDeadlineAt)
                : undefined),
          },
        });
      }
      return task;
    });
  }

  pollingRecord(ref: BrowserOccurrenceRef) {
    return this.db.browserPostOccurrence.findFirst({
      where: {
        workflowId: ref.workflowId,
        postId: ref.postId,
        post: { organizationId: ref.organizationId },
      },
      select: {
        status: true,
        resultDeadlineAt: true,
        reviewEmailPending: true,
        reason: true,
        post: { select: { browserWorkflowId: true, deletedAt: true } },
      },
    });
  }

  markReviewEmailQueued(ref: BrowserOccurrenceRef) {
    return this.db.browserPostOccurrence.updateMany({
      where: {
        workflowId: ref.workflowId,
        postId: ref.postId,
        reviewEmailPending: { not: null },
      },
      data: { reviewEmailPending: null },
    });
  }

  rememberDeadline(ref: BrowserOccurrenceRef, deadline: string) {
    return this.db.browserPostOccurrence.updateMany({
      where: {
        workflowId: ref.workflowId,
        postId: ref.postId,
        resultDeadlineAt: null,
      },
      data: { resultDeadlineAt: new Date(deadline) },
    });
  }

  async reviewRecord(
    organizationId: string,
    workflowId: string,
    memberId?: string
  ) {
    const record = await this.db.browserPostOccurrence.findFirst({
      where: {
        workflowId,
        post: {
          organizationId,
          ...(memberId && {
            deletedAt: null,
            organization: {
              users: { some: { userId: memberId, disabled: false } },
            },
          }),
        },
      },
    });
    if (!record)
      throw new NotFoundException('Browser occurrence was not found');
    return { ...record, reason: browserReasonMessage(record.reason) };
  }

  async incidents(organizationId: string, cursor?: string) {
    const records = await this.db.browserPostOccurrence.findMany({
      where: {
        post: { organizationId },
        OR: [
          { reviewRequiredAt: { not: null } },
          { status: { in: ['unknown', 'timed_out'] } },
        ],
      },
      orderBy: [{ dueAt: 'desc' }, { workflowId: 'asc' }],
      take: 100,
      ...(cursor && { cursor: { workflowId: cursor }, skip: 1 }),
    });
    return records.map((run) => ({
      ...run,
      reason: browserReasonMessage(run.reason),
    }));
  }

  async settle(
    ref: BrowserOccurrenceRef,
    outcome: BrowserOutcome,
    evidence: {
      reason?: string;
      url?: string;
      releaseId?: string;
      onlyBeforeStart?: boolean;
      reviewerId?: string;
      note?: string;
    } = {}
  ) {
    return this.db.$transaction(async (tx) => {
      // Serialize review and late-receipt settlement with binding changes.
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${ref.organizationId} FOR KEY SHARE`;
      const post = await this.lockPost(tx, ref);
      if (!post || post.browserWorkflowId !== ref.workflowId) return;
      const run = await tx.browserPostOccurrence.findUnique({
        where: { workflowId: ref.workflowId },
      });
      if (
        !run ||
        run.postId !== post.id ||
        (run.settledAt && run.status !== 'unknown') ||
        (evidence.reviewerId &&
          !['unknown', 'needs_review'].includes(run.status)) ||
        (evidence.onlyBeforeStart && run.status !== 'pending')
      )
        return;
      if (outcome === 'unknown') {
        if (run.reviewRequiredAt) return;
        const message = `Browser publication ${
          ref.workflowId
        } scheduled for ${run.dueAt.toISOString()} needs review. Check the platform account.`;
        await tx.browserPostOccurrence.update({
          where: { workflowId: ref.workflowId },
          data: {
            status: 'needs_review',
            settledAt: null,
            reviewRequiredAt: new Date(),
            reviewReason: evidence.reason,
            reviewEmailPending: message,
            reason: evidence.reason,
          },
        });
        await tx.post.update({
          where: { id: post.id },
          data: { state: 'ERROR', browserLocked: true },
        });
        await tx.notifications.create({
          data: { organizationId: ref.organizationId, content: message },
        });
        return message;
      }
      const repeat = outcome === 'published' && Number(post.intervalInDays) > 0;
      const nextWorkflowId = repeat ? 'post_' + randomUUID() : null;
      const intervalMs = (post.intervalInDays || 0) * 86400000;
      const steps = repeat
        ? Math.max(
            1,
            Math.floor((Date.now() - run.dueAt.getTime()) / intervalMs) + 1
          )
        : 0;
      const nextDueAt = new Date(run.dueAt.getTime() + steps * intervalMs);
      await tx.browserPostOccurrence.update({
        where: { workflowId: ref.workflowId },
        data: {
          status: outcome,
          settledAt: new Date(),
          nextWorkflowId,
          reason: evidence.reason || null,
          releaseId: evidence.releaseId,
          url: evidence.url,
          ...(evidence.reviewerId && {
            reviewerId: evidence.reviewerId,
            reviewedAt: new Date(),
            note: evidence.note,
          }),
        },
      });
      await tx.post.update({
        where: { id: post.id },
        data: {
          browserLocked: false,
          state: repeat
            ? 'QUEUE'
            : outcome === 'published'
            ? 'PUBLISHED'
            : outcome === 'prepared'
            ? 'DRAFT'
            : 'ERROR',
          releaseId: evidence.releaseId || null,
          releaseURL: evidence.url || null,
          error: evidence.reason
            ? JSON.stringify({
                cause: {
                  type: 'bad_body',
                  failure: { message: browserReasonMessage(evidence.reason) },
                },
              })
            : null,
          ...(repeat
            ? {
                browserWorkflowId: nextWorkflowId,
                browserDueAt: nextDueAt,
                browserClaimDeadlineAt: browserClaimDeadline(nextDueAt),
                browserImmediate: false,
              }
            : {}),
        },
      });
    });
  }

  async next(ref: BrowserOccurrenceRef) {
    const run = await this.db.browserPostOccurrence.findUnique({
      where: { workflowId: ref.workflowId, postId: ref.postId },
      select: {
        nextWorkflowId: true,
        post: { select: { browserWorkflowId: true, deletedAt: true } },
      },
    });
    return run &&
      !run.post.deletedAt &&
      run.post.browserWorkflowId === run.nextWorkflowId
      ? run.nextWorkflowId
      : null;
  }
}
