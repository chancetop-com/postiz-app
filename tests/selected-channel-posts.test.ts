import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * Ticket 08: a save, reschedule or delete of a multi-channel post applies only
 * to the channels the user ticked, and only to their own organization.
 *
 * This runs the shipped PostsService and PostsRepository against a real
 * PostgreSQL database (DATABASE_URL) instead of a mocked delegate: the
 * scoping is enforced by the Prisma queries (`organizationId`, per-channel
 * `group`, `batchId`), so the persistence boundary is the seam under test.
 * Platform sends are observed at the Temporal client boundary that creates the
 * per-post publish execution.
 */

vi.hoisted(() => {
  process.env.STORAGE_PROVIDER = 'local';
  process.env.UPLOAD_DIRECTORY = `${process.env.TMPDIR || '/tmp'}/postiz-ticket-08-${process.pid}`;
  process.env.FRONTEND_URL = 'http://localhost:4308';
  process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY = '/uploads';
});

import { PrismaClient } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { EncryptionService } from '@gitroom/nestjs-libraries/services/encryption.service';
import type { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import type { Post } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

type Started = {
  type: string;
  workflowId: string;
  temporalQueue: string;
  providerQueue: string;
  postId: string;
  organizationId: string;
  publishDate: string;
};

let prisma: PrismaClient;
let service: PostsService;
let started: Started[] = [];
let terminated: string[] = [];

const orgA = `ticket08-org-a-${process.pid}`;
const orgB = `ticket08-org-b-${process.pid}`;
const batch = `ticket08-batch-${process.pid}`;
const sharedGroup = `ticket08-shared-group-${process.pid}`;

const ids = {
  a1: `ticket08-a1-${process.pid}`,
  a2: `ticket08-a2-${process.pid}`,
  a3: `ticket08-a3-${process.pid}`,
  b1: `ticket08-b1-${process.pid}`,
  ia1: `ticket08-ia1-${process.pid}`,
  ia2: `ticket08-ia2-${process.pid}`,
  ia3: `ticket08-ia3-${process.pid}`,
  ib1: `ticket08-ib1-${process.pid}`,
};

const future = (hours: number) =>
  new Date(Date.now() + hours * 60 * 60 * 1000);

const seed = async () => {
  await prisma.organization.createMany({
    data: [
      { id: orgA, name: 'Ticket 08 A' },
      { id: orgB, name: 'Ticket 08 B' },
    ],
  });

  for (const [id, organizationId, name] of [
    [ids.ia1, orgA, 'A one'],
    [ids.ia2, orgA, 'A two'],
    [ids.ia3, orgA, 'A three'],
    [ids.ib1, orgB, 'B one'],
  ] as const) {
    await prisma.integration.create({
      data: {
        id,
        internalId: id,
        organizationId,
        name,
        providerIdentifier: 'x',
        type: 'social',
        token: 'synthetic-token',
        profile: name,
        picture: 'https://example.invalid/avatar.png',
        postingTimes: '[]',
        additionalSettings: '[]',
      },
    });
  }

  const post = (
    id: string,
    organizationId: string,
    integrationId: string,
    group: string,
    state: 'QUEUE' | 'DRAFT' | 'PUBLISHED',
    publishDate: Date,
    content: string
  ): Post => ({
    id,
    organizationId,
    integrationId,
    group,
    batchId: batch,
    state,
    publishDate,
    content,
    delay: 0,
    title: null,
    description: null,
    parentPostId: null,
    releaseId: null,
    releaseURL: null,
    settings: JSON.stringify({ __type: 'x' }),
    image: '[]',
    submittedForOrderId: null,
    submittedForOrganizationId: null,
    approvedSubmitForOrder: 'NO',
    creationMethod: 'WEB',
    lastMessageId: null,
    intervalInDays: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });

  await prisma.post.createMany({
    data: [
      // the channel that is ticked in every scenario
      post(
        ids.a1,
        orgA,
        ids.ia1,
        sharedGroup,
        'QUEUE',
        future(24),
        'a-one original'
      ),
      // a same-batch sibling that is never ticked
      post(
        ids.a2,
        orgA,
        ids.ia2,
        `ticket08-group-a2-${process.pid}`,
        'QUEUE',
        future(48),
        'a-two original'
      ),
      // another same-batch sibling that stays a draft
      post(
        ids.a3,
        orgA,
        ids.ia3,
        `ticket08-group-a3-${process.pid}`,
        'DRAFT',
        future(72),
        'a-three original'
      ),
      // another organization, even reusing the group id of A1
      post(
        ids.b1,
        orgB,
        ids.ib1,
        sharedGroup,
        'QUEUE',
        future(96),
        'b-one original'
      ),
    ],
  });
};

const postById = (id: string) => prisma.post.findUniqueOrThrow({ where: { id } });

const request = (
  type: CreatePostDto['type'],
  posts: Array<{
    integration: string;
    group: string;
    postId: string;
    content: string;
    date: Date;
  }>
): CreatePostDto =>
  ({
    type,
    shortLink: false,
    date: new Date().toISOString(),
    tags: [],
    posts: posts.map((p) => ({
      integration: { id: p.integration },
      group: p.group,
      date: p.date.toISOString(),
      settings: { __type: 'x' },
      value: [{ id: p.postId, content: p.content, delay: 0, image: [] }],
    })),
  } as any);

const until = async (predicate: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!predicate() && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const snapshot = async (id: string) => {
  const row = await postById(id);
  return {
    id: row.id,
    state: row.state,
    publishDate: row.publishDate.toISOString(),
    content: row.content,
    deletedAt: row.deletedAt?.toISOString() || null,
  };
};

suite('selected-channel posts', () => {
  beforeAll(async () => {
    if (!databaseUrl) {
      return;
    }

    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await prisma.$connect();
    await seed();

    const encryption = new EncryptionService();
    const forModel = () => new PrismaRepository<any>(prisma as any) as any;

    const postsRepository = new PostsRepository(
      forModel(),
      forModel(),
      forModel(),
      forModel(),
      forModel(),
      forModel(),
      encryption
    );
    const integrationRepository = new IntegrationRepository(
      forModel(),
      forModel(),
      forModel(),
      forModel(),
      forModel(),
      forModel(),
      encryption
    );

    started = [];
    terminated = [];
    const temporal = {
      client: {
        getRawClient: () => ({
          workflow: {
            list: async function* ({ query }: { query: string }) {
              const wanted = /postId="([^"]+)"/.exec(query)?.[1];
              if (wanted === ids.a1) {
                yield { workflowId: `post_${wanted}` };
              }
            },
            start: async (
              type: string,
              options: {
                workflowId: string;
                taskQueue: string;
                args: Array<{
                  taskQueue: string;
                  postId: string;
                  organizationId: string;
                }>;
              }
            ) => {
              const row = await prisma.post.findUnique({
                where: { id: options.args[0].postId },
              });
              started.push({
                type,
                workflowId: options.workflowId,
                temporalQueue: options.taskQueue,
                providerQueue: options.args[0].taskQueue,
                postId: options.args[0].postId,
                organizationId: options.args[0].organizationId,
                publishDate: row!.publishDate.toISOString(),
              });
            },
          },
        }),
        getWorkflowHandle: (workflowId: string) => ({
          describe: async () => ({ status: { name: 'RUNNING' } }),
          terminate: async () => {
            terminated.push(workflowId);
          },
        }),
      },
    };

    service = new PostsService(
      postsRepository,
      new IntegrationManager(),
      {
        getIntegrationById: (org: string, id: string) =>
          integrationRepository.getIntegrationById(org, id),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      temporal as any,
      {} as any
    );
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }
    await prisma.post.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.integration.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgA, orgB] } },
    });
    await prisma.$disconnect();
  });

  it('save as draft moves only the ticked channel; the sibling payload keeps it', async () => {
    started = [];
    const beforeA2 = await snapshot(ids.a2);
    const beforeA3 = await snapshot(ids.a3);
    const beforeB1 = await snapshot(ids.b1);

    // what the editor sends when A1 is ticked and A2/A3 are not:
    // A1 as draft, A2 (QUEUE) as the schedule that keeps its own date, A3
    // (DRAFT) as the draft that keeps it.
    await service.createPost(orgA, request('draft', [
      {
        integration: ids.ia1,
        group: (await postById(ids.a1)).group,
        postId: ids.a1,
        content: 'a-one edited',
        date: future(24),
      },
    ]), 'WEB');
    await service.createPost(orgA, request('schedule', [
      {
        integration: ids.ia2,
        group: (await postById(ids.a2)).group,
        postId: ids.a2,
        content: beforeA2.content,
        date: new Date(beforeA2.publishDate),
      },
    ]), 'WEB');
    await service.createPost(orgA, request('draft', [
      {
        integration: ids.ia3,
        group: (await postById(ids.a3)).group,
        postId: ids.a3,
        content: beforeA3.content,
        date: new Date(beforeA3.publishDate),
      },
    ]), 'WEB');

    const a1 = await postById(ids.a1);
    expect(a1.state).toBe('DRAFT');
    expect(a1.content).toBe('a-one edited');

    expect(await snapshot(ids.a2)).toEqual(beforeA2);
    expect(await snapshot(ids.a3)).toEqual(beforeA3);
    expect(await snapshot(ids.b1)).toEqual(beforeB1);
    // the draft is not queued, the unticked sibling keeps its own schedule
    await until(() => started.length >= 1);
    expect(started.filter((run) => run.postId === ids.a1)).toHaveLength(0);
    expect(started.filter((run) => run.postId === ids.a2)).toHaveLength(1);
  });

  it('post now publishes the ticked channel only', async () => {
    started = [];
    await prisma.post.update({
      where: { id: ids.a1 },
      data: { state: 'QUEUE', batchId: batch },
    });
    const beforeA2 = await snapshot(ids.a2);
    const beforeA3 = await snapshot(ids.a3);
    const beforeB1 = await snapshot(ids.b1);

    await service.createPost(orgA, request('now', [
      {
        integration: ids.ia1,
        group: (await postById(ids.a1)).group,
        postId: ids.a1,
        content: 'a-one posted now',
        date: new Date(),
      },
    ]), 'WEB');
    await service.createPost(orgA, request('schedule', [
      {
        integration: ids.ia2,
        group: (await postById(ids.a2)).group,
        postId: ids.a2,
        content: beforeA2.content,
        date: new Date(beforeA2.publishDate),
      },
    ]), 'WEB');
    await service.createPost(orgA, request('draft', [
      {
        integration: ids.ia3,
        group: (await postById(ids.a3)).group,
        postId: ids.a3,
        content: beforeA3.content,
        date: new Date(beforeA3.publishDate),
      },
    ]), 'WEB');

    const a1 = await postById(ids.a1);
    expect(a1.state).toBe('QUEUE');
    expect(a1.content).toBe('a-one posted now');
    expect(a1.publishDate.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(a1.publishDate.getTime()).toBeLessThan(Date.now() + 60_000);

    expect(await snapshot(ids.a2)).toEqual(beforeA2);
    expect(await snapshot(ids.a3)).toEqual(beforeA3);
    expect(await snapshot(ids.b1)).toEqual(beforeB1);

    await until(() => started.length >= 2);
    // one immediate publish request for the ticked channel, on its provider
    // queue; the unticked sibling only gets the future execution its schedule
    // already had, and the draft and the other organization get none
    const immediate = started.filter((run) => run.postId === ids.a1);
    expect(immediate).toHaveLength(1);
    expect(immediate[0]).toMatchObject({
      type: 'postWorkflowV112',
      workflowId: `post_${ids.a1}`,
      temporalQueue: 'main',
      providerQueue: 'x',
      organizationId: orgA,
    });
    // the unticked sibling keeps the future execution it already had
    const sibling = started.filter((run) => run.postId === ids.a2);
    expect(sibling).toHaveLength(1);
    expect(sibling[0].publishDate).toBe(beforeA2.publishDate);
    expect(started.filter((run) => run.postId === ids.b1)).toHaveLength(0);
    expect(started.filter((run) => run.postId === ids.a3)).toHaveLength(0);
  });

  it('reschedules only the ticked channel and refuses another organization', async () => {
    const beforeA2 = await snapshot(ids.a2);
    const beforeA3 = await snapshot(ids.a3);
    const beforeB1 = await snapshot(ids.b1);

    // the editor's Schedule button sends the ticked channel with its date
    started = [];
    const scheduled = future(5);
    await service.createPost(orgA, request('schedule', [
      {
        integration: ids.ia1,
        group: (await postById(ids.a1)).group,
        postId: ids.a1,
        content: 'a-one rescheduled',
        date: scheduled,
      },
    ]), 'WEB');

    await until(() => started.some((run) => run.postId === ids.a1));
    let a1 = await postById(ids.a1);
    expect(a1.state).toBe('QUEUE');
    expect(a1.content).toBe('a-one rescheduled');
    expect(a1.publishDate.toISOString()).toBe(scheduled.toISOString());
    expect(started.filter((run) => run.postId === ids.a1)).toHaveLength(1);
    expect(await snapshot(ids.a2)).toEqual(beforeA2);
    expect(await snapshot(ids.a3)).toEqual(beforeA3);

    // the calendar drag uses the post id and can move the date without
    // changing the state or the other channels
    const moved = future(6);
    await service.changeDate(orgA, ids.a1, moved.toISOString(), 'update');
    a1 = await postById(ids.a1);
    expect(a1.publishDate.toISOString()).toBe(moved.toISOString());
    expect(a1.content).toBe('a-one rescheduled');
    expect(await snapshot(ids.a2)).toEqual(beforeA2);
    expect(await snapshot(ids.a3)).toEqual(beforeA3);

    await expect(
      service.changeDate(orgB, ids.a1, future(7).toISOString(), 'schedule')
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.changeDate(orgA, ids.b1, future(7).toISOString(), 'schedule')
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await snapshot(ids.b1)).toEqual(beforeB1);
    expect(await snapshot(ids.a2)).toEqual(beforeA2);
    expect(await snapshot(ids.a3)).toEqual(beforeA3);
  });

  it('opens only same-organization siblings for the editor selection', async () => {
    const a2 = await postById(ids.a2);
    const group = await service.getPostsByGroup(orgA, a2.group);
    expect(group.integration).toBe(ids.ia2);
    // B1 shares the batch id but must never appear in A's channel checklist
    expect(group.siblings.map((sibling) => sibling.integration).sort()).toEqual(
      [ids.ia1, ids.ia3].sort()
    );
  });

  it('deletes only the ticked channel group, also when another organization reuses the group id', async () => {
    terminated = [];
    const beforeA2 = await snapshot(ids.a2);
    const beforeA3 = await snapshot(ids.a3);
    const beforeB1 = await snapshot(ids.b1);
    // the editor sends the group the channel has now, and another
    // organization may hold the same id
    const tickedGroup = (await postById(ids.a1)).group;
    await prisma.post.update({
      where: { id: ids.b1 },
      data: { group: tickedGroup },
    });

    await service.deletePost(orgA, tickedGroup);

    const a1 = await postById(ids.a1);
    expect(a1.deletedAt).not.toBeNull();
    expect(await snapshot(ids.a2)).toEqual(beforeA2);
    expect(await snapshot(ids.a3)).toEqual(beforeA3);
    expect(await snapshot(ids.b1)).toEqual(beforeB1);

    // the publish execution of the deleted channel is the only one terminated
    expect(terminated.filter((id) => id === `post_${ids.a1}`)).toHaveLength(1);
    expect(terminated.filter((id) => id === `post_${ids.b1}`)).toHaveLength(0);
  });

  it('refuses an integration from another organization before it resolves a post', async () => {
    const beforeB1 = await snapshot(ids.b1);

    await expect(
      service.mapTypeToPost(
        {
          type: 'draft',
          shortLink: false,
          date: future(1).toISOString(),
          tags: [],
          posts: [
            {
              integration: { id: ids.ib1 },
              settings: { __type: 'x' },
              value: [{ id: ids.b1, content: 'stolen' }],
            },
          ],
        } as any,
        orgA
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await snapshot(ids.b1)).toEqual(beforeB1);
  });

  it('refuses a post id from another organization instead of writing it', async () => {
    const beforeB1 = await snapshot(ids.b1);

    await expect(
      service.createPost(orgA, request('update', [
        {
          integration: ids.ia1,
          group: sharedGroup,
          postId: ids.b1,
          content: 'stolen',
          date: future(1),
        },
      ]), 'WEB')
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(await snapshot(ids.b1)).toEqual(beforeB1);
  });
});
