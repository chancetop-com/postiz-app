import {
  BrowserChannelRevoked,
  BrowserOccurrenceRepository,
} from './browser-occurrence.repository';
import { PostsService } from '../posts/posts.service';
import { NotificationService } from '../notifications/notification.service';
import { isRevokedReason, revokedReasonCode } from './occurrence';
import type {
  BrowserOccurrenceRef,
  BrowserReviewDecision,
  BrowserStartRef,
} from './occurrence';
import type { PendingCheckResponse } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BrowserProfileInput,
  isBrowserProvider,
  isBrowserPlatform,
} from '@gitroom/helpers/utils/browser-publishing';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BrowserPublishingRepository } from './browser-publishing.repository';

const pickupTimeout = 'Timed out waiting for an execution node';

@Injectable()
export class BrowserPublishingService {
  private readonly logger = new Logger(BrowserPublishingService.name);
  constructor(
    private repository: BrowserPublishingRepository,
    private runs: BrowserOccurrenceRepository,
    private notifications: NotificationService,
    private posts: PostsService
  ) {}

  schedule(ref: BrowserOccurrenceRef) {
    return this.runs.schedule(ref);
  }
  timing(ref: BrowserOccurrenceRef) {
    return this.runs.timing(ref);
  }
  async prepare(ref: BrowserOccurrenceRef) {
    const timing = await this.runs.timing(ref);
    if (
      !timing?.prepareAt ||
      Date.now() < Date.parse(timing.prepareAt) ||
      Date.now() >= Date.parse(timing.uploadAt)
    )
      return;
    try {
      const task = await this.runs.task(ref, false, true);
      await this.gateway(
        '',
        { task, expiresAt: timing.uploadAt },
        'preparations'
      );
    } catch (error) {
      // The executing desktop checks and obtains missing bytes at the upload wake.
      if (!(error instanceof HttpException)) throw error;
    }
  }
  async authorizeStart(ref: BrowserStartRef) {
    try {
      return await this.runs.task(ref, true);
    } catch (error) {
      if (
        error instanceof HttpException &&
        [403, 409].includes(error.getStatus())
      ) {
        await this.runs.settle(ref, 'failed', {
          reason:
            error instanceof BrowserChannelRevoked
              ? revokedReasonCode
              : error.message,
          onlyBeforeStart: true,
        });
      }
      throw error;
    }
  }
  nextOccurrence(ref: BrowserOccurrenceRef) {
    return this.runs.next(ref);
  }

  private async gateway(
    path: string,
    task?: unknown,
    resource = 'occurrences'
  ) {
    const base = process.env.SAU_GATEWAY_URL;
    const token = process.env.GATEWAY_INTERNAL_TOKEN;
    if (!base || !token)
      throw new Error('Browser publishing Gateway is not configured');
    return fetch(base.replace(/\/$/, '') + '/internal/' + resource + path, {
      method: task ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + token,
      },
      ...(task ? { body: JSON.stringify(task) } : {}),
    });
  }

  async handoff(ref: BrowserOccurrenceRef) {
    // If the previous activity lost its acknowledgement, resume the committed occurrence.
    // Check the database clock first. A later authoritative 404 can then distinguish
    // a missed handoff from an accepted claim whose acknowledgement was lost.
    const expired = await this.runs.pickupExpired(ref);
    const prior = await this.gateway('/' + encodeURIComponent(ref.workflowId));
    if (prior.ok) return true;
    if (prior.status !== 404) throw new Error('Gateway lookup failed');
    if (expired) {
      await this.runs.settle(ref, 'timed_out', {
        reason: pickupTimeout,
        onlyBeforeStart: true,
      });
      return false;
    }
    try {
      const task = await this.runs.task(ref, false);
      const response = await this.gateway('', task);
      if (response.ok) return true;
      if (response.status !== 422)
        throw new Error('Gateway handoff unavailable');
      await this.runs.settle(ref, 'failed', {
        reason: 'Desktop release cannot run the selected action',
      });
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() === 425)
        throw error;
      await this.runs.settle(ref, 'failed', {
        reason:
          error instanceof BrowserChannelRevoked
            ? revokedReasonCode
            : error.message,
      });
    }
    return false;
  }

  private async syncRevocation(
    ref: BrowserOccurrenceRef,
    run: { status: string; reason: string | null } | null
  ) {
    if (run?.status === 'failed' && isRevokedReason(run.reason)) {
      // A previously accepted task may still be waiting for a desktop. Retrying this
      // activity after a lost response settles that same Gateway record once.
      await this.revokeGateway(ref);
    }
  }

  private async revokeGateway(ref: BrowserOccurrenceRef) {
    const { workflowId, organizationId, postId } = ref;
    const response = await this.gateway('/revoke', {
      workflowId,
      organizationId,
      postId,
    });
    if (!response.ok && response.status !== 404)
      throw new ServiceUnavailableException(
        'Gateway revocation is unavailable'
      );
  }

  async syncPendingRevocations(organizationId?: string) {
    for (;;) {
      const batch = await this.repository.pendingRevocations(organizationId);
      for (const ref of batch) {
        try {
          await this.revokeGateway(ref);
        } catch {
          this.logger.warn(
            'Gateway revocation is pending for ' + ref.workflowId
          );
          return;
        }
        await this.repository.acknowledgeRevocation(ref.workflowId);
      }
      if (batch.length < 100) return;
    }
  }

  async checkPending(ref: BrowserOccurrenceRef): Promise<PendingCheckResponse> {
    const run = await this.runs.pollingRecord(ref);
    await this.syncRevocation(ref, run);
    if (run?.reviewEmailPending)
      await this.queueReviewEmail(ref, run.reviewEmailPending);
    if (
      !run ||
      run.post.deletedAt ||
      run.post.browserWorkflowId !== ref.workflowId ||
      !['pending', 'publishing'].includes(run.status)
    )
      return { status: 'completed', postId: '', releaseURL: '' };
    let record;
    try {
      record = await this.record(ref);
    } catch (error) {
      if (
        !(error instanceof ServiceUnavailableException) ||
        !run.resultDeadlineAt
      )
        throw error;
      if (run.resultDeadlineAt.getTime() > Date.now())
        return {
          status: 'pending',
          pendingData: {
            ...ref,
            nextDeadlineAt: run.resultDeadlineAt.toISOString(),
          },
        };
      record = { state: 'unknown', overdueAt: run.resultDeadlineAt };
    }
    if (record.resultDeadlineAt && !run.resultDeadlineAt)
      await this.runs.rememberDeadline(ref, record.resultDeadlineAt);
    // A desktop can commit a late receipt before our first poll after the
    // deadline. Enter review once; opening the review reads that receipt.
    const result = await this.applyGateway(
      ref,
      record.overdueAt
        ? { state: 'unknown', overdueAt: record.overdueAt }
        : record
    );
    if (result.status === 'completed') {
      // Revocation may have won the post lock while the terminal Gateway lookup was in flight.
      await this.syncRevocation(ref, await this.runs.pollingRecord(ref));
    }
    return result;
  }

  private async record(ref: BrowserOccurrenceRef) {
    let response: Response;
    try {
      response = await this.gateway('/' + encodeURIComponent(ref.workflowId));
    } catch {
      throw new ServiceUnavailableException('Gateway result is unavailable');
    }
    if (!response.ok)
      throw new ServiceUnavailableException('Gateway result is unavailable');
    const record = await response.json();
    if (
      record.workflowId !== ref.workflowId ||
      record.task?.postId !== ref.postId ||
      record.task?.organizationId !== ref.organizationId
    )
      throw new Error('Gateway returned another occurrence');
    return record;
  }

  private async applyGateway(
    ref: BrowserOccurrenceRef,
    record: any
  ): Promise<PendingCheckResponse> {
    if (record.state === 'timed_out') {
      await this.runs.settle(ref, 'timed_out', {
        reason: pickupTimeout,
        onlyBeforeStart: true,
      });
      return { status: 'completed', postId: '', releaseURL: '' };
    }
    const receipt = record.receipt;
    const outcome = record.state === 'unknown' ? 'unknown' : receipt?.outcome;
    if (!outcome || outcome === 'processing')
      return {
        status: 'pending',
        pendingData: {
          ...ref,
          nextDeadlineAt: record.resultDeadlineAt || record.claimDeadlineAt,
        },
      };
    if (!['published', 'prepared', 'failed', 'unknown'].includes(outcome))
      throw new Error('Unrecognized Gateway receipt');
    const reasons: Record<string, string> = {
      login_required:
        'Open the platform account to sign in or complete verification.',
      verification_required:
        'Complete the verification challenge in the platform account.',
      upload_timeout: 'The upload timed out before submission.',
      pre_submit_failure: 'The desktop could not submit this post.',
      authorization_declined: 'The browser channel could not start the upload.',
      possible_submission:
        'The platform may have received this post. Check the account before publishing again.',
    };
    const reason =
      outcome === 'unknown' && record.overdueAt && !receipt?.exitCode
        ? 'The desktop did not report a final result by the deadline. Check the platform account.'
        : reasons[receipt?.reason] ||
          (outcome === 'unknown'
            ? reasons.possible_submission
            : outcome === 'failed'
            ? reasons.pre_submit_failure
            : undefined);
    const message = await this.runs.settle(ref, outcome, {
      reason,
      url: receipt?.url,
      releaseId: receipt?.releaseId,
    });
    if (message) await this.queueReviewEmail(ref, message);
    return {
      status: 'completed',
      postId: receipt?.releaseId || '',
      releaseURL: receipt?.url || '',
    };
  }

  private async queueReviewEmail(ref: BrowserOccurrenceRef, message: string) {
    await this.notifications.sendEmailsToOrg(
      ref.organizationId,
      'Browser publication needs review',
      message,
      'fail',
      ref.workflowId
    );
    await this.runs.markReviewEmailQueued(ref);
  }

  incidents(org: string, cursor?: string) {
    return this.runs.incidents(org, cursor);
  }

  async evidence(organizationId: string, workflowId: string) {
    const run = await this.runs.reviewRecord(organizationId, workflowId);
    const response = await this.gateway('/' + encodeURIComponent(workflowId));
    if (response.status === 404) return { ...run, gateway: null };
    if (!response.ok)
      throw new ServiceUnavailableException('Gateway evidence is unavailable');
    const record = await response.json();
    if (
      record.task?.organizationId !== organizationId ||
      record.task?.postId !== run.postId ||
      record.workflowId !== workflowId
    )
      throw new Error('Gateway returned another occurrence');
    const { task, ...gateway } = record;
    return { ...run, gateway };
  }

  async review(
    organizationId: string,
    workflowId: string,
    actorId: string,
    operator: boolean,
    decision?: BrowserReviewDecision
  ) {
    const member = operator ? undefined : actorId;
    const run = await this.runs.reviewRecord(
      organizationId,
      workflowId,
      member
    );
    if (!run.reviewRequiredAt && run.status !== 'unknown')
      throw new ConflictException('This occurrence has not entered review');
    const ref = { organizationId, workflowId, postId: run.postId };
    const record = await this.record(ref);
    await this.applyGateway(ref, record);
    if (decision) {
      if (!['published', 'failed'].includes(decision.outcome))
        throw new BadRequestException('Select a published or failed outcome');
      for (const [value, limit] of [
        [decision.releaseId, 512],
        [decision.url, 2048],
        [decision.note, 2000],
      ] as const) {
        if (
          value !== undefined &&
          (typeof value !== 'string' || value.length > limit)
        )
          throw new BadRequestException(
            'Review evidence exceeds the allowed length'
          );
      }
      if (decision.url) {
        let url: URL;
        try {
          url = new URL(decision.url);
        } catch {
          throw new BadRequestException('Enter a valid post URL');
        }
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new BadRequestException(
            'Enter a public HTTP or HTTPS post URL'
          );
      }
      await this.runs.settle(ref, decision.outcome, {
        reviewerId: actorId,
        releaseId: decision.releaseId,
        url: decision.url,
        note: decision.note,
        reason:
          decision.outcome === 'failed'
            ? 'A reviewer confirmed that this post was not published.'
            : undefined,
      });
    }
    const next = await this.runs.next(ref);
    if (next)
      await this.posts.startWorkflow(
        'browser',
        ref.postId,
        organizationId,
        'QUEUE',
        next
      );
    return this.runs.reviewRecord(organizationId, workflowId, member);
  }

  async setEnabled(
    org: string,
    body: { merchantId: string; enabled: boolean }
  ) {
    if (
      typeof body?.merchantId !== 'string' ||
      !body.merchantId.trim() ||
      typeof body.enabled !== 'boolean'
    ) {
      throw new BadRequestException(
        'A merchantId and boolean enabled are required'
      );
    }
    const merchant = await this.repository.setEnabled(
      org,
      body.merchantId.trim(),
      body.enabled
    );
    if (!body.enabled) await this.syncPendingRevocations(org);
    return merchant;
  }

  async bind(org: string, input: BrowserProfileInput) {
    if (
      !isBrowserProvider(input?.provider) ||
      (input.provider === 'local-chrome' &&
        process.env.BROWSER_PUBLISHING_DEV_TEST_TARGETS !== 'true') ||
      typeof input.profileId !== 'string' ||
      !input.profileId.trim() ||
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      !Array.isArray(input.platforms) ||
      !input.platforms.length ||
      !input.platforms.every(isBrowserPlatform) ||
      new Set(input.platforms).size !== input.platforms.length
    ) {
      throw new BadRequestException(
        'Specify provider, profileId, name and the supported platforms signed into the profile'
      );
    }
    const binding = await this.repository.bind(org, {
      ...input,
      name: input.name.trim(),
      profileId: input.profileId.trim(),
    });
    await this.syncPendingRevocations(org);
    return binding;
  }

  async unbind(org: string, bindingId: string) {
    const binding = await this.repository.unbind(org, bindingId);
    await this.syncPendingRevocations(org);
    return binding;
  }
}
