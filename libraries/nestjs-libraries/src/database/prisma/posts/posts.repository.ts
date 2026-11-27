import {
  browserPublishContent,
  SelectedBrowserMedia,
} from '../browser-publishing/browser-publish-content';
import { isBrowserChannel } from '@gitroom/helpers/utils/browser-publishing';
import {
  browserClaimDeadline,
  browserReasonMessage,
} from '../browser-publishing/occurrence';
import { postableChannel } from '../browser-publishing/channel-access';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  CreatePostDto,
  Post as PostBody,
} from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import {
  APPROVED_SUBMIT_FOR_ORDER,
  CreationMethod,
  Integration,
  Prisma,
  Post,
  State,
} from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import utc from 'dayjs/plugin/utc';
import { v4 as uuidv4 } from 'uuid';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';
import {
  EncryptionService,
  integrationEncryptedFields,
} from '@gitroom/nestjs-libraries/services/encryption.service';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);
dayjs.extend(isSameOrAfter);
dayjs.extend(utc);

@Injectable()
export class PostsRepository {
  constructor(
    private _post: PrismaRepository<
      'post' | 'browserPostOccurrence' | 'media' | '$transaction'
    >,
    private _popularPosts: PrismaRepository<'popularPosts'>,
    private _comments: PrismaRepository<'comments'>,
    private _tags: PrismaRepository<'tags'>,
    private _tagsPosts: PrismaRepository<'tagsPosts'>,
    private _errors: PrismaRepository<'errors'>,
    private _encryptionService: EncryptionService
  ) {}

  browserPublishContent(
    org: string,
    identifier: string,
    content: string,
    settings: Record<string, unknown>,
    media: SelectedBrowserMedia[]
  ) {
    return browserPublishContent(
      this._post.model,
      org,
      identifier,
      content,
      settings,
      media
    );
  }

  // A post that was loaded with its whole channel carries the tokens of the
  // channel the way they are stored, so they are decrypted like in the
  // integration repository
  private async decryptIntegration<
    T extends { integration?: Integration | null }
  >(post: T | null) {
    return post?.integration
      ? {
          ...post,
          integration: await this._encryptionService.decryptFields(
            post.integration,
            integrationEncryptedFields
          ),
        }
      : post;
  }

  searchForMissingThreeHoursPosts() {
    const window = {
      gte: dayjs.utc().subtract(2, 'day').toDate(),
      lt: dayjs.utc().toDate(),
    };
    return this._post.model.post.findMany({
      where: {
        OR: [
          // Recurring browser posts retain the first publishDate as their calendar anchor.
          { browserWorkflowId: { not: null }, browserDueAt: window },
          {
            browserWorkflowId: null,
            publishDate: window,
            integration: {
              refreshNeeded: false,
              inBetweenSteps: false,
              disabled: false,
              deletedAt: null,
            },
          },
        ],
        state: 'QUEUE',
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        organizationId: true,
        integration: {
          select: {
            providerIdentifier: true,
          },
        },
        publishDate: true,
        browserWorkflowId: true,
      },
    });
  }

  getPostState(id: string) {
    return this._post.model.post.findUnique({
      where: {
        id,
        deletedAt: null,
      },
      select: {
        state: true,
        browserWorkflowId: true,
      },
    });
  }

  getOldPosts(orgId: string, date: string) {
    return this._post.model.post.findMany({
      where: {
        integration: {
          refreshNeeded: false,
          inBetweenSteps: false,
          disabled: false,
        },
        organizationId: orgId,
        publishDate: {
          lte: dayjs(date).toDate(),
        },
        deletedAt: null,
        parentPostId: null,
      },
      orderBy: {
        publishDate: 'desc',
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }

  updateImages(id: string, images: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        image: images,
      },
    });
  }

  getPostUrls(orgId: string, ids: string[]) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        releaseURL: true,
      },
    });
  }

  // Post.error persists the raw serialized workflow failure; only curated
  // provider messages are surfaced to the calendar and the public API —
  // bad_body failures whose message came from a provider handleErrors
  // mapping or a hand-written provider throw (unmapped API responses carry
  // the 'Unknown Error' placeholder instead). Internal debug strings (e.g.
  // 'Refresh channel needed') and unmapped failures come out as null.
  private curatedError(error?: string | null): string | null {
    if (!error) {
      return null;
    }
    try {
      const parsed = JSON.parse(error);
      const [type, message] = parsed?.cause?.failure?.message
        ? [parsed?.cause?.type, parsed?.cause?.failure?.message]
        : [
            parsed?.failure?.cause?.applicationFailureInfo?.type,
            parsed?.failure?.cause?.message,
          ];
      return type === 'bad_body' && message && message !== 'Unknown Error'
        ? message
        : null;
    } catch (err) {
      return null;
    }
  }

  async getPosts(orgId: string, query: GetPostsDto) {
    // Use the provided start and end dates directly
    const startDate = dayjs.utc(query.startDate).toDate();
    const endDate = dayjs.utc(query.endDate).toDate();

    const list = await this._post.model.post.findMany({
      where: {
        AND: [
          {
            OR: [
              {
                organizationId: orgId,
              },
            ],
          },
          {
            OR: [
              {
                publishDate: {
                  gte: startDate,
                  lte: endDate,
                },
              },
              {
                browserOccurrences: {
                  some: {
                    settledAt: { not: null },
                    dueAt: { gte: startDate, lte: endDate },
                  },
                },
              },
              {
                intervalInDays: {
                  not: null,
                },
              },
            ],
          },
        ],
        integration: {
          OR: [{ deletedAt: null }, { browserBindingId: { not: null } }],
          organizationId: orgId,
          ...(query.customer ? { customerId: query.customer } : {}),
        },
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        releaseId: true,
        state: true,
        error: true,
        browserWorkflowId: true,
        browserDueAt: true,
        browserOccurrences: {
          where: { dueAt: { gte: startDate, lte: endDate } },
          select: {
            workflowId: true,
            dueAt: true,
            status: true,
            settledAt: true,
            reason: true,
          },
          orderBy: { settledAt: { sort: 'desc', nulls: 'last' } },
        },
        intervalInDays: true,
        group: true,
        creationMethod: true,
        settings: true,
        tags: {
          where: {
            tag: {
              deletedAt: null,
            },
          },
          select: {
            tag: true,
          },
        },
        integration: {
          select: {
            id: true,
            providerIdentifier: true,
            name: true,
            picture: true,
          },
        },
      },
    });

    // This runs on the request thread, so keep it linear: push into one array
    // (spreading the accumulator on every post was quadratic and blocked the
    // event loop for seconds on large orgs), and expand repeating posts only
    // inside [startDate, endDate] instead of from their first publish date.
    const rangeStart = dayjs.utc(startDate);
    const rangeEnd = dayjs.utc(endDate);
    const result: any[] = [];

    for (const row of list) {
      const { browserOccurrences, browserWorkflowId, browserDueAt, ...item } =
        row;
      const post = { ...item, error: this.curatedError(row.error) };
      // Several saves can have the same scheduled instant. Only the current run
      // or an actually settled historical run may supply that card's state.
      const byInstant = new Map<number, (typeof browserOccurrences)[number]>();
      const active = browserOccurrences.find(
        (run) => run.workflowId === browserWorkflowId
      );
      for (const run of browserOccurrences) {
        const instant = run.dueAt.getTime();
        if (run === active || (run.settledAt && !byInstant.has(instant)))
          byInstant.set(instant, run);
      }
      const card = (date: Date, run?: (typeof browserOccurrences)[number]) => ({
        ...post,
        publishDate: date,
        ...(post.intervalInDays && { actualDate: post.publishDate }),
        ...(run && {
          browserStatus: run.status === 'unknown' ? 'needs_review' : run.status,
          browserWorkflowId: run.workflowId,
          error: browserReasonMessage(run.reason),
          state:
            run.status === 'published'
              ? 'PUBLISHED'
              : run.status === 'prepared'
              ? 'DRAFT'
              : ['failed', 'unknown', 'needs_review', 'timed_out'].includes(
                  run.status
                )
              ? 'ERROR'
              : 'QUEUE',
        }),
      });
      // A reschedule can change both the anchor and the interval. Settled runs
      // have their own durable dates, including when the author turns repetition off.
      for (const run of byInstant.values()) {
        if (run.settledAt) result.push(card(run.dueAt, run));
      }
      const browser = isBrowserChannel(row.integration.providerIdentifier);
      if (
        !post.intervalInDays ||
        post.intervalInDays < 1 ||
        (browser && row.state !== 'QUEUE')
      ) {
        const due = browserDueAt ?? row.publishDate;
        const run = byInstant.get(+due);
        if (due >= startDate && due <= endDate && !run?.settledAt)
          result.push(card(due, run));
        continue;
      }

      const firstDate = dayjs.utc(
        browser ? browserDueAt ?? post.publishDate : post.publishDate
      );
      let occurrence = firstDate;
      if (rangeStart.isAfter(firstDate)) {
        const skip = Math.ceil(
          rangeStart.diff(firstDate, 'day', true) / post.intervalInDays
        );
        occurrence = firstDate.add(skip * post.intervalInDays, 'day');
      }

      while (!occurrence.isAfter(rangeEnd)) {
        const run = byInstant.get(occurrence.valueOf());
        if (!run?.settledAt) result.push(card(occurrence.toDate(), run));
        occurrence = occurrence.add(post.intervalInDays, 'day');
      }
    }

    return result;
  }

  async getPostsList(orgId: string, query: GetPostsListDto) {
    const page = query.page || 0;
    const limit = query.limit || 20;
    const skip = page * limit;

    const stateFilter = query.state || 'all';
    const stateAndDate =
      stateFilter === 'scheduled'
        ? {
            state: State.QUEUE,
          }
        : stateFilter === 'draft'
        ? { state: State.DRAFT }
        : stateFilter === 'published'
        ? { state: State.PUBLISHED }
        : {
            state: {
              in: [State.QUEUE, State.DRAFT, State.PUBLISHED, State.ERROR],
            },
          };

    const orderDirection: 'asc' | 'desc' =
      stateFilter === 'published' ? 'desc' : 'asc';

    const where = {
      AND: [
        {
          OR: [
            {
              organizationId: orgId,
            },
          ],
        },
      ],
      ...stateAndDate,
      // Published posts were already posted (publishDate in the past), so fetch
      // all of them; everything else stays upcoming. Ordering handles the rest.
      ...(stateFilter === 'published'
        ? {}
        : { publishDate: { gte: dayjs.utc().toDate() } }),
      deletedAt: null as Date | null,
      parentPostId: null as string | null,
      intervalInDays: null as number | null,

      integration: {
        OR: [{ deletedAt: null }, { browserBindingId: { not: null } }],
        organizationId: orgId,
        ...(query.customer
          ? {
              customerId: query.customer,
            }
          : {}),
        ...(query.integrations
          ? {
              id: { in: query.integrations },
            }
          : {}),
      },
    };

    const [posts, total] = await Promise.all([
      this._post.model.post.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          publishDate: orderDirection,
        },
        select: {
          id: true,
          content: true,
          publishDate: true,
          releaseURL: true,
          releaseId: true,
          state: true,
          intervalInDays: true,
          group: true,
          creationMethod: true,
          browserWorkflowId: true,
          tags: {
            where: {
              tag: {
                deletedAt: null,
              },
            },
            select: {
              tag: true,
            },
          },
          integration: {
            select: {
              id: true,
              providerIdentifier: true,
              name: true,
              picture: true,
            },
          },
        },
      }),
      this._post.model.post.count({ where }),
    ]);

    const workflowIds = posts
      .map((post) => post.browserWorkflowId)
      .filter(Boolean);
    const runs = workflowIds.length
      ? await this._post.model.browserPostOccurrence.findMany({
          where: { workflowId: { in: workflowIds } },
          select: { workflowId: true, status: true, reason: true },
        })
      : [];
    const statuses = new Map(runs.map((run) => [run.workflowId, run]));
    return {
      posts: posts.map(({ browserWorkflowId, ...post }) => {
        const run = statuses.get(browserWorkflowId);
        return run
          ? {
              ...post,
              browserWorkflowId,
              browserStatus:
                run.status === 'unknown' ? 'needs_review' : run.status,
              error: browserReasonMessage(run.reason),
            }
          : post;
      }),
      total,
      page,
      limit,
      hasMore: skip + posts.length < total,
    };
  }

  // Content changes and the worker's upload grant take the same post row lock.
  // Lock all editor rows before writing, including the old group on a channel switch.
  private async lockEditable(
    tx: Prisma.TransactionClient,
    org: string,
    ids: string[],
    groups: string[] = []
  ) {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${org} FOR KEY SHARE`;
    const rows = await tx.$queryRaw<
      { id: string; group: string; name: string; browserLocked: boolean }[]
    >`
      SELECT p.id, p."group", p."browserLocked", i.name FROM "Post" p
      JOIN "Integration" i ON i.id = p."integrationId" WHERE p."organizationId" = ${org}
      AND (p."group" IN (${
        groups.length ? Prisma.join(groups) : Prisma.sql`NULL`
      })
           OR p.id IN (${ids.length ? Prisma.join(ids) : Prisma.sql`NULL`}))
      AND p."deletedAt" IS NULL ORDER BY p.id FOR UPDATE OF p`;
    const locked = rows.find((row) => row.browserLocked);
    if (locked)
      throw new ConflictException(locked.name + ': Publishing has started');
    return rows;
  }

  async updateBrowserSettings(
    orgId: string,
    post: Post,
    settings: Record<string, unknown>
  ) {
    await this._post.model.$transaction(async (tx) => {
      await this.lockEditable(tx, orgId, [post.id]);
      // Validation used this version of the content, settings and channel. A
      // concurrent edit, authorization or revocation must win before this write.
      const updated = await tx.post.updateMany({
        where: {
          id: post.id,
          organizationId: orgId,
          deletedAt: null,
          state: post.state,
          updatedAt: post.updatedAt,
          integrationId: post.integrationId,
          integration: postableChannel,
          browserWorkflowId: post.browserWorkflowId,
        },
        data: { settings: JSON.stringify(settings) },
      });
      if (!updated.count)
        throw new ConflictException(
          'Post or channel changed while updating settings'
        );
    });
  }

  async deletePost(orgId: string, group: string) {
    return this._post.model.$transaction(async (tx) => {
      await this.lockEditable(tx, orgId, [], [group]);
      await tx.post.updateMany({
        where: {
          organizationId: orgId,
          group,
        },
        data: {
          deletedAt: new Date(),
        },
      });

      return tx.post.findFirst({
        where: {
          organizationId: orgId,
          group,
          parentPostId: null,
        },
        select: {
          id: true,
        },
      });
    });
  }

  async getPostsByGroup(orgId: string, group: string) {
    const posts = await this._post.model.post.findMany({
      where: {
        group,
        ...(orgId ? { organizationId: orgId } : {}),
        deletedAt: null,
      },
      include: {
        integration: true,
        tags: {
          where: {
            tag: {
              deletedAt: null,
            },
          },
          select: {
            tag: true,
          },
        },
      },
    });

    return Promise.all(posts.map((p) => this.decryptIntegration(p)));
  }

  // the posts of the other channels in the batch, without the given group
  getPostsByBatch(orgId: string, batchId: string, exceptGroup: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        batchId,
        group: {
          not: exceptGroup,
        },
        deletedAt: null,
        integration: {
          deletedAt: null,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async getPost(
    id: string,
    includeIntegration = false,
    orgId?: string,
    isFirst?: boolean
  ) {
    const post = await this._post.model.post.findUnique({
      where: {
        id,
        ...(orgId ? { organizationId: orgId } : {}),
        deletedAt: null,
      },
      include: {
        ...(includeIntegration
          ? {
              integration: true,
              tags: {
                where: {
                  tag: {
                    deletedAt: null,
                  },
                },
                select: {
                  tag: true,
                },
              },
            }
          : {}),
        childrenPost: true,
      },
    });

    return this.decryptIntegration(post);
  }

  updatePost(id: string, postId: string, releaseURL: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        state: 'PUBLISHED',
        releaseURL,
        releaseId: postId,
      },
    });
  }

  updateReleaseId(
    id: string,
    orgId: string,
    releaseId: string,
    releaseURL?: string
  ) {
    return this._post.model.post.update({
      where: {
        id,
        organizationId: orgId,
        releaseId: 'missing',
      },
      data: {
        releaseId: String(releaseId),
        ...(releaseURL ? { releaseURL } : {}),
      },
    });
  }

  updateResolvedRelease(
    id: string,
    orgId: string,
    releaseId: string,
    releaseURL: string
  ) {
    return this._post.model.post.update({
      where: {
        id,
        organizationId: orgId,
      },
      data: {
        releaseId,
        releaseURL,
      },
    });
  }

  changeScheduledState(
    id: string,
    org: string,
    state: 'QUEUE' | 'DRAFT',
    browser: boolean
  ) {
    return this._post.model.$transaction(async (tx) => {
      await this.lockEditable(tx, org, [id]);
      const post = await tx.post.findUniqueOrThrow({
        where: { id, organizationId: org, deletedAt: null },
      });
      if (browser && state === 'QUEUE' && post.state === 'PUBLISHED')
        throw new ConflictException('This post has already been published');
      return tx.post.update({
        where: { id },
        data: {
          state,
          ...(browser
            ? {
                browserWorkflowId:
                  state === 'DRAFT' ? null : 'post_' + uuidv4(),
                browserDueAt: state === 'DRAFT' ? null : post.publishDate,
                browserClaimDeadlineAt:
                  state === 'DRAFT'
                    ? null
                    : browserClaimDeadline(post.publishDate),
                browserImmediate: false,
              }
            : {}),
        },
      });
    });
  }

  async changeState(id: string, state: State, err?: any, body?: any) {
    const update = await this._post.model.post.update({
      where: {
        id,
      },
      data: {
        state,
        ...(err
          ? { error: typeof err === 'string' ? err : JSON.stringify(err) }
          : {}),
      },
      include: {
        integration: {
          select: {
            providerIdentifier: true,
          },
        },
      },
    });

    if (state === 'ERROR' && err && body) {
      try {
        await this._errors.model.errors.create({
          data: {
            message: typeof err === 'string' ? err : JSON.stringify(err),
            organizationId: update.organizationId,
            platform: update.integration.providerIdentifier,
            postId: update.id,
            body: typeof body === 'string' ? body : JSON.stringify(body),
          },
        });
      } catch (err) {}
    }

    return update;
  }

  getErrorsByPostIds(postIds: string[]) {
    return this._errors.model.errors.findMany({
      where: {
        postId: { in: postIds },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async changeDate(
    orgId: string,
    id: string,
    date: string,
    isDraft: boolean,
    action: 'schedule' | 'update' = 'schedule',
    republish = false,
    assertScheduleAllowed?: () => Promise<void>
  ) {
    return this._post.model.$transaction(async (tx) => {
      await this.lockEditable(tx, orgId, [id]);
      const current = await tx.post.findUnique({
        where: { id, organizationId: orgId },
        include: { integration: { select: { providerIdentifier: true } } },
      });
      const browser = isBrowserChannel(current?.integration.providerIdentifier);
      if (browser) {
        isDraft = current.state === 'DRAFT';
        if (!isDraft && (action === 'schedule' || current.state === 'QUEUE')) await assertScheduleAllowed?.();
      }
      if (
        browser &&
        action === 'schedule' &&
        current.state === 'PUBLISHED' &&
        !republish
      ) {
        throw new ConflictException('This post has already been published');
      }
      return tx.post.update({
        where: {
          organizationId: orgId,
          id,
        },
        data: {
          publishDate: dayjs(date).toDate(),
          ...(browser &&
          !isDraft &&
          (action === 'schedule' || current?.state === 'QUEUE')
            ? {
                browserWorkflowId: 'post_' + uuidv4(),
                browserDueAt: dayjs(date).toDate(),
                browserClaimDeadlineAt: browserClaimDeadline(
                  dayjs(date).toDate()
                ),
                browserImmediate: false,
              }
            : {}),
          // schedule: set state to QUEUE (or DRAFT if it was a draft)
          // update: don't change the state
          ...(action === 'schedule'
            ? {
                state: isDraft ? 'DRAFT' : 'QUEUE',
                releaseId: null,
                releaseURL: null,
              }
            : {}),
        },
      });
    });
  }

  countPostsFromDay(orgId: string, date: Date) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        publishDate: {
          gte: date,
        },
        OR: [
          {
            deletedAt: null,
            state: {
              in: ['QUEUE'],
            },
          },
          {
            state: 'PUBLISHED',
          },
        ],
      },
    });
  }

  countPostsOfOtherOrganizations(orgId: string, ids: string[]) {
    return this._post.model.post.count({
      where: {
        organizationId: {
          not: orgId,
        },
        id: {
          in: ids,
        },
      },
    });
  }

  async createOrUpdatePosts(
    orgId: string,
    submission: CreatePostDto,
    creationMethod: CreationMethod,
    keepGroup: boolean
  ) {
    const batchId = uuidv4();
    const { posts: bodies } = submission;
    return this._post.model.$transaction(async (tx) => {
      const groups = bodies.map((body) => body.group).filter(Boolean);
      const ids = bodies.flatMap((body) =>
        body.value.map((v) => v.id).filter(Boolean)
      );
      const rows = await this.lockEditable(tx, orgId, ids, groups);
      if (bodies.some((body) => isBrowserChannel(body.settings.__type))) {
        const channels = await tx.integration.findMany({
          where: {
            organizationId: orgId,
            id: { in: bodies.map((body) => body.integration.id) },
            ...postableChannel,
          },
          select: { id: true, browserBindingId: true },
        });
        const claimed = new Set<string>();
        for (const body of bodies) {
          const channel = channels.find((c) => c.id === body.integration.id);
          if (
            !channel ||
            (body.integration.bindingId !== undefined &&
              channel.browserBindingId !== body.integration.bindingId)
          ) {
            throw new BadRequestException(
              body.integration.id + ': Channel is no longer available'
            );
          }
          const ids = new Set(body.value.map((value) => value.id));
          for (const row of rows.filter(
            (row) => row.group === body.group || ids.has(row.id)
          )) {
            if (claimed.has(row.id)) {
              throw new BadRequestException(
                row.name +
                  ': A saved post belongs to one account per submission'
              );
            }
            claimed.add(row.id);
          }
        }
      }
      const results: Post[][] = [];
      for (const channel of bodies) {
        results.push(
          await this.saveChannelPosts(
            tx,
            orgId,
            submission,
            channel,
            creationMethod,
            keepGroup,
            batchId
          )
        );
      }
      return results;
    });
  }

  private async saveChannelPosts(
    tx: Prisma.TransactionClient,
    orgId: string,
    submission: CreatePostDto,
    body: PostBody,
    creationMethod: CreationMethod,
    keepGroup: boolean,
    batchId: string
  ) {
    const { type: state, tags, inter, republish } = submission;
    const posts: Post[] = [];
    const uuid = uuidv4();
    const group = keepGroup && body.group ? body.group : uuid;

    // an edited post stays in the batch it was created in, even when it is
    // saved on its own or with a group that was rotated since
    const ids = body.value.map((value) => value.id).filter(Boolean);
    const isBrowser = isBrowserChannel(body.settings?.__type);
    const date = state !== 'now' ? body.date || submission.date :
      isBrowser ? submission.date : dayjs(submission.date).format('YYYY-MM-DDTHH:mm:00');
    const saveDate = dayjs(date).toDate();
    const prior = ids[0]
      ? await tx.post.findUnique({
          where: { id: ids[0], organizationId: orgId },
        })
      : null;
    if (
      isBrowser &&
      prior?.state === 'PUBLISHED' &&
      ['now', 'schedule'].includes(state) &&
      !republish
    ) {
      throw new ConflictException('This post has already been published');
    }
    const sameDueAndChannel =
      prior?.publishDate.getTime() === saveDate.getTime() &&
      prior.integrationId === body.integration.id;
    // Re-saving the scheduled editor with revised copy/media keeps its cache,
    // claim deadline and pending workflow. A new schedule gets its own identity.
    const scheduleChanged =
      state === 'update'
        ? prior?.state === 'QUEUE' && !sameDueAndChannel
        : !(
            state === 'schedule' &&
            prior?.state === 'QUEUE' &&
            prior.browserWorkflowId &&
            !prior.browserImmediate &&
            sameDueAndChannel
          );
    const browserSchedule =
      !isBrowser || state === 'draft'
        ? {
            browserWorkflowId: null,
            browserDueAt: null,
            browserClaimDeadlineAt: null,
            browserImmediate: false,
          }
        : scheduleChanged
        ? {
            browserWorkflowId: 'post_' + uuidv4(),
            browserDueAt: saveDate,
            browserClaimDeadlineAt: browserClaimDeadline(saveDate),
            browserImmediate: state === 'now',
          }
        : {};
    const existingBatchId =
      body.group || ids.length
        ? (
            await tx.post.findFirst({
              where: {
                organizationId: orgId,
                deletedAt: null,
                batchId: {
                  not: null,
                },
                OR: [
                  ...(body.group ? [{ group: body.group }] : []),
                  ...(ids.length ? [{ id: { in: ids } }] : []),
                ],
              },
              select: {
                batchId: true,
              },
            })
          )?.batchId
        : undefined;

    for (const value of body.value) {
      const updateData = (type: 'create' | 'update') => ({
        publishDate: saveDate,
        ...(!posts.length ? browserSchedule : {}),
        browserDraftEditor:
          (state === 'draft' ||
            (state === 'update' && prior?.state === 'DRAFT')) &&
          isBrowser &&
          !posts.length &&
          body.draftEditor
            ? JSON.stringify(body.draftEditor)
            : null,
        integration: {
          connect: {
            ...postableChannel,
            id: body.integration.id,
            organizationId: orgId,
          },
        },
        ...(posts?.[posts.length - 1]?.id
          ? {
              parentPost: {
                connect: {
                  id: posts[posts.length - 1]?.id,
                },
              },
            }
          : type === 'update'
          ? {
              parentPost: {
                disconnect: true,
              },
            }
          : {}),
        content: value.content,
        delay: value.delay || 0,
        group,
        batchId: existingBatchId || batchId,
        intervalInDays: inter ? +inter : null,
        approvedSubmitForOrder: APPROVED_SUBMIT_FOR_ORDER.NO,
        ...(type === 'create' ? { creationMethod } : {}),
        ...(state === 'update'
          ? {}
          : {
              state:
                state === 'draft' ? ('DRAFT' as const) : ('QUEUE' as const),
            }),
        image: JSON.stringify(value.image),
        settings: JSON.stringify(body.settings),
        organization: {
          connect: {
            id: orgId,
          },
        },
      });

      posts.push(
        await tx.post.upsert({
          where: {
            id: value.id || uuidv4(),
            organizationId: orgId,
          },
          create: { ...updateData('create') },
          update: {
            ...updateData('update'),
            lastMessage: {
              disconnect: true,
            },
            submittedForOrder: {
              disconnect: true,
            },
          },
        })
      );

      if (posts.length === 1) {
        await tx.tagsPosts.deleteMany({
          where: {
            post: {
              id: posts[0].id,
            },
          },
        });

        if (tags.length) {
          const tagsList = await tx.tags.findMany({
            where: {
              orgId: orgId,
              deletedAt: null,
              name: {
                in: tags.map((tag) => tag.label).filter((f) => f),
              },
            },
          });

          if (tagsList.length) {
            await tx.post.update({
              where: {
                id: posts[posts.length - 1].id,
              },
              data: {
                tags: {
                  createMany: {
                    data: tagsList.map((tag) => ({
                      tagId: tag.id,
                    })),
                  },
                },
              },
            });
          }
        }
      }
    }

    if (body.group && !keepGroup) {
      await tx.post.updateMany({
        where: {
          organizationId: orgId,
          group: body.group,
          deletedAt: null,
        },
        data: {
          parentPostId: null,
          deletedAt: new Date(),
        },
      });
    }

    // keepGroup: the updated rows still carry the old group, so sweep only the
    // rows dropped from it (removed comments) by id instead of by group.
    if (body.group && keepGroup) {
      await tx.post.updateMany({
        where: {
          organizationId: orgId,
          group: body.group,
          deletedAt: null,
          id: {
            notIn: posts.map((p) => p.id),
          },
        },
        data: {
          parentPostId: null,
          deletedAt: new Date(),
        },
      });
    }

    return posts;
  }

  async submit(id: string, order: string, buyerOrganizationId: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        submittedForOrderId: order,
        approvedSubmitForOrder: 'WAITING_CONFIRMATION',
        submittedForOrganizationId: buyerOrganizationId,
      },
      select: {
        id: true,
        description: true,
        submittedForOrder: {
          select: {
            messageGroupId: true,
          },
        },
      },
    });
  }

  updateMessage(id: string, messageId: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        lastMessageId: messageId,
      },
    });
  }

  async getPostById(id: string, org?: string) {
    const post = await this._post.model.post.findUnique({
      where: {
        id,
        ...(org ? { organizationId: org } : {}),
      },
      include: {
        integration: true,
        submittedForOrder: {
          include: {
            posts: {
              where: {
                state: 'PUBLISHED',
              },
            },
            ordersItems: true,
            seller: {
              select: {
                id: true,
                account: true,
              },
            },
          },
        },
      },
    });

    return this.decryptIntegration(post);
  }

  private get postTimelineSelect() {
    return {
      id: true,
      state: true,
      publishDate: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      releaseId: true,
      releaseURL: true,
      error: true,
      creationMethod: true,
      group: true,
      parentPostId: true,
    } as const;
  }

  getPostTimeline(id: string, org: string) {
    return this._post.model.post.findFirst({
      where: {
        id,
        organizationId: org,
      },
      select: {
        ...this.postTimelineSelect,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            disabled: true,
            refreshNeeded: true,
            deletedAt: true,
          },
        },
        childrenPost: {
          select: this.postTimelineSelect,
          orderBy: { publishDate: 'asc' as const },
        },
        errors: {
          select: {
            id: true,
            platform: true,
            message: true,
            body: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' as const },
        },
      },
    });
  }

  findAllExistingCategories() {
    return this._popularPosts.model.popularPosts.findMany({
      select: {
        category: true,
      },
      distinct: ['category'],
    });
  }

  findAllExistingTopicsOfCategory(category: string) {
    return this._popularPosts.model.popularPosts.findMany({
      where: {
        category,
      },
      select: {
        topic: true,
      },
      distinct: ['topic'],
    });
  }

  findPopularPosts(category: string, topic?: string) {
    return this._popularPosts.model.popularPosts.findMany({
      where: {
        category,
        ...(topic ? { topic } : {}),
      },
      select: {
        content: true,
        hook: true,
      },
    });
  }

  createPopularPosts(post: {
    category: string;
    topic: string;
    content: string;
    hook: string;
  }) {
    return this._popularPosts.model.popularPosts.create({
      data: {
        category: 'category',
        topic: 'topic',
        content: 'content',
        hook: 'hook',
      },
    });
  }

  async getPostsCountsByDates(
    orgId: string,
    times: number[],
    date: dayjs.Dayjs
  ) {
    const dates = await this._post.model.post.findMany({
      where: {
        deletedAt: null,
        organizationId: orgId,
        publishDate: {
          in: times.map((time) => {
            return date.clone().add(time, 'minutes').toDate();
          }),
        },
      },
    });

    return times.filter(
      (time) =>
        date.clone().add(time, 'minutes').isAfter(dayjs.utc()) &&
        !dates.find((dateFind) => {
          return (
            dayjs
              .utc(dateFind.publishDate)
              .diff(date.clone().startOf('day'), 'minutes') == time
          );
        })
    );
  }

  getCommentsForPosts(postIds: string[]) {
    return this._comments.model.comments.findMany({
      where: {
        postId: {
          in: postIds,
        },
        deletedAt: null,
      },
      include: {
        user: {
          select: {
            name: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  getCommentById(id: string) {
    return this._comments.model.comments.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        post: {
          select: {
            id: true,
            organizationId: true,
          },
        },
      },
    });
  }

  setCommentResolved(id: string, resolvedAt: Date | null) {
    return this._comments.model.comments.update({
      where: {
        id,
      },
      data: {
        resolvedAt,
      },
    });
  }

  getAnchoredCommentsForPost(postId: string) {
    return this._comments.model.comments.findMany({
      where: {
        postId,
        deletedAt: null,
        anchorStart: {
          not: null,
        },
      },
    });
  }

  detachAnchorsForPost(postId: string, ids: string[]) {
    return this._comments.model.comments.updateMany({
      where: {
        postId,
        id: {
          in: ids,
        },
      },
      data: {
        anchorStart: null,
        anchorEnd: null,
      },
    });
  }

  async getTags(orgId: string) {
    return this._tags.model.tags.findMany({
      where: {
        orgId,
        deletedAt: null,
      },
    });
  }

  createTag(orgId: string, body: CreateTagDto) {
    return this._tags.model.tags.create({
      data: {
        orgId,
        name: body.name,
        color: body.color,
      },
    });
  }

  editTag(id: string, orgId: string, body: CreateTagDto) {
    return this._tags.model.tags.update({
      where: {
        id,
      },
      data: {
        name: body.name,
        color: body.color,
      },
    });
  }

  async deleteTag(id: string, orgId: string) {
    const tag = await this._tags.model.tags.update({
      where: {
        id,
        orgId,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    await this._tagsPosts.model.tagsPosts.deleteMany({
      where: {
        tagId: tag.id,
      },
    });

    return tag;
  }

  createComment(
    orgId: string,
    userId: string | null,
    postId: string,
    content: string,
    extra: {
      displayName?: string;
      parentId?: string;
      anchorStart?: number;
      anchorEnd?: number;
      anchorQuote?: string;
    } = {}
  ) {
    return this._comments.model.comments.create({
      data: {
        organizationId: orgId,
        userId,
        postId,
        content,
        displayName: extra.displayName ?? null,
        parentId: extra.parentId ?? null,
        anchorStart: extra.anchorStart ?? null,
        anchorEnd: extra.anchorEnd ?? null,
        anchorQuote: extra.anchorQuote ?? null,
      },
    });
  }

  async getPostByForWebhookId(postId: string, integrationId: string) {
    const select = {
      id: true,
      content: true,
      publishDate: true,
      releaseURL: true,
      state: true,
      integration: {
        select: {
          id: true,
          name: true,
          providerIdentifier: true,
          picture: true,
          type: true,
        },
      },
    };

    const posts = await this._post.model.post.findMany({
      where: {
        id: postId,
        deletedAt: null,
        parentPostId: null,
      },
      select,
    });

    if (posts.length) {
      return posts;
    }

    // The running workflows pass the platform's post id, which updatePost
    // already stored on the row as releaseId before the webhook is sent.
    return this._post.model.post.findMany({
      where: {
        releaseId: postId,
        integrationId,
        deletedAt: null,
        parentPostId: null,
      },
      orderBy: {
        updatedAt: 'desc' as const,
      },
      take: 1,
      select,
    });
  }

  async getPostsSince(orgId: string, since: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        publishDate: {
          gte: new Date(since),
        },
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }
}
