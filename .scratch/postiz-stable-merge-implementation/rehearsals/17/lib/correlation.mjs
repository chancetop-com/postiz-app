/**
 * Correlation helpers for the coordinated-recovery scenario.
 *
 * A database dump and a copy of the media volume are only a backup when they
 * are taken from the same quiesced point. This module takes both, restores
 * both, and re-compares them against the identifiers Temporal still holds.
 *
 * Credentials are compared by digest only; the evidence files never contain
 * token values.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Recursively digests every file under `root` (relative path → sha256). */
export function digestTree(root) {
  const result = {};
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        result[relative(root, absolute)] = sha256(readFileSync(absolute));
      }
    }
  };
  walk(root);
  return result;
}

export function copyTree(from, to) {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  const walk = (directory, target) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const source = join(directory, entry.name);
      const destination = join(target, entry.name);
      if (entry.isDirectory()) {
        mkdirSync(destination, { recursive: true });
        walk(source, destination);
      } else if (entry.isFile()) {
        copyFileSync(source, destination);
      }
    }
  };
  walk(from, to);
}

export function restoreTree(backup, target) {
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    rmSync(join(target, entry.name), { recursive: true, force: true });
  }
  copyTree(backup, target);
}

export function fileSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

/**
 * The business rows a recovery must preserve. `digest` covers every column
 * (credentials included) so a changed token is detected even though the
 * evidence only shows the digest.
 */
export async function businessSnapshot(prisma, organizationIds) {
  const scope = { organizationId: { in: organizationIds } };
  const [organizations, integrations, posts, media] = [
    await prisma.organization.findMany({ where: { id: { in: organizationIds } } }),
    await prisma.integration.findMany({ where: scope }),
    await prisma.post.findMany({ where: scope, orderBy: { id: 'asc' } }),
    await prisma.media.findMany({ where: scope, orderBy: { id: 'asc' } }),
  ];

  const serializable = {
    organizations,
    integrations,
    posts,
    media,
  };

  return {
    digest: sha256(JSON.stringify(serializable)),
    counts: {
      organizations: organizations.length,
      integrations: integrations.length,
      posts: posts.length,
      media: media.length,
    },
    organizations: organizations.map(({ id, name }) => ({ id, name })),
    integrations: integrations.map((integration) => ({
      id: integration.id,
      organizationId: integration.organizationId,
      providerIdentifier: integration.providerIdentifier,
      internalId: integration.internalId,
      rootInternalId: integration.rootInternalId,
      refreshNeeded: integration.refreshNeeded,
      tokenDigest: sha256(String(integration.token ?? null)),
    })),
    posts: posts.map((post) => ({
      id: post.id,
      organizationId: post.organizationId,
      integrationId: post.integrationId,
      state: post.state,
      publishDate: post.publishDate?.toISOString?.() ?? null,
      releaseId: post.releaseId,
      releaseURL: post.releaseURL,
      parentPostId: post.parentPostId,
      image: post.image,
      deletedAt: post.deletedAt ? post.deletedAt.toISOString() : null,
    })),
    media: media.map((item) => ({
      id: item.id,
      organizationId: item.organizationId,
      path: item.path,
      status: item.status,
    })),
  };
}

/**
 * The written schema: every public column and index. A failed sync is not
 * assumed to have changed nothing, so the caller compares this before/after.
 */
export async function schemaSnapshot(prisma) {
  const columns = await prisma.$queryRaw`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;
  const indexes = await prisma.$queryRaw`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY indexname
  `;
  const serialized = JSON.stringify({ columns, indexes });
  return {
    digest: sha256(serialized),
    tables: new Set(columns.map((column) => column.table_name)).size,
    columns: columns.length,
    indexes: indexes.length,
  };
}

export function dumpDatabase(container, file) {
  const dump = execFileSync(
    'docker',
    [
      'exec',
      container,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'postiz',
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  writeFileSync(file, dump);
  return { file, bytes: Buffer.byteLength(dump), sha256: sha256(dump) };
}

/**
 * Restores a dump into the same disposable database. Callers must stop every
 * writer first: a dump restored under a live writer is exactly the mistake the
 * ticket warns about.
 */
export function restoreDatabase(container, file) {
  const dump = readFileSync(file, 'utf8');
  execFileSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postiz', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: dump, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' }
  );
  return { file, bytes: Buffer.byteLength(dump) };
}

export function compareTrees(before, after) {
  const added = Object.keys(after).filter((path) => !(path in before));
  const removed = Object.keys(before).filter((path) => !(path in after));
  const changed = Object.keys(before).filter(
    (path) => path in after && before[path] !== after[path]
  );
  return { added, removed, changed, identical: !added.length && !removed.length && !changed.length };
}
