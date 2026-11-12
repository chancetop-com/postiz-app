/**
 * Derives the "patched legacy" workflow bundle used for post-patch-marker
 * fixtures.
 *
 * It is the pre-upgrade source (commit C) plus ONLY the documented
 * `patched()` / continue-as-new gates that the candidate adds to same-named
 * workflows. Every transform asserts that its anchor occurs exactly once, so a
 * drift in the extracted sources fails loudly instead of silently producing a
 * different bundle.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LEGACY_DIR } from './paths.mjs';

const workflowImport = `import {
  continueAsNew,
  patched,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';`;

const autopostGate = `    await sleep(3600000);

    // Keep the history small, runs started before this patch continue-as-new on their first live loop
    if (
      patched('autopost-continue-as-new') &&
      (++loops >= 24 || workflowInfo().historyLength > 1000)
    ) {
      return await continueAsNew<typeof autoPostWorkflow>({
        id,
        immediately: true,
      });
    }
  }
}`;

const missingGate = `    await sleep('1 hour');

    // Keep the history small, the new run searches immediately so the hourly cadence is kept
    if (
      patched('missing-post-continue-as-new') &&
      (++loops >= 24 || workflowInfo().historyLength > 1000)
    ) {
      return await continueAsNew<typeof missingPostWorkflow>();
    }

    await searchForMissingThreeHoursPosts();`;

const transforms = [
  {
    file: 'autopost.workflow.ts',
    edits: [
      {
        find: `import { proxyActivities, sleep } from '@temporalio/workflow';`,
        replace: workflowImport,
      },
      {
        find: `  while (true) {
    try {`,
        replace: `  let loops = 0;
  while (true) {
    try {`,
      },
      {
        find: `    await sleep(3600000);
  }
}`,
        replace: autopostGate,
      },
    ],
  },
  {
    file: 'missing.post.workflow.ts',
    edits: [
      {
        find: `import { proxyActivities, sleep } from '@temporalio/workflow';`,
        replace: workflowImport,
      },
      {
        find: `  while (true) {
    await sleep('1 hour');
    await searchForMissingThreeHoursPosts();
  }
}`,
        replace: `  let loops = 0;
  while (true) {
${missingGate}
  }
}`,
      },
    ],
  },
  {
    file: 'streak.workflow.ts',
    edits: [
      {
        find: `import { proxyActivities, sleep } from '@temporalio/workflow';`,
        replace: `import {
  makeContinueAsNewFunc,
  patched,
  proxyActivities,
  sleep,
} from '@temporalio/workflow';`,
      },
      {
        find: `const { sendEmailAsync, getUserOrgs, setStreak } = proxyActivities<EmailActivity>({`,
        replace: `const { sendEmailAsync, getUserOrgs, setStreak, getLastPublishDate } =
  proxyActivities<EmailActivity>({`,
      },
      {
        find: `  const userOrgs = await getUserOrgs(organizationId);
  for (const user of userOrgs.users) {`,
        replace: `  const userOrgs = await getUserOrgs(organizationId);

  if (!patched('reminder')) {
    for (const user of userOrgs.users) {`,
      },
      {
        find: `      'Streak Reminder',
      '<p>You are about to lose your streak in two hours! schedule a post now to keep it!</p>',
      'bottom'
    );
  }
  await sleep(7200000);
  await setStreak(organizationId, 'end');`,
        replace: `      'Streak Reminder',
      '<p>You are about to lose your streak in two hours! schedule a post now to keep it!</p>',
      'bottom'
    );
    }
  }
  await sleep(7200000);

  // Posts no longer restart this workflow, hand the streak over to
  // streakWorkflowV2 if the organization posted since it started
  if (patched('streak-last-post')) {
    const lastPost = await getLastPublishDate(organizationId);
    if (lastPost && lastPost + DAY > Date.now()) {
      return await makeContinueAsNewFunc<typeof streakWorkflowV2>({
        workflowType: 'streakWorkflowV2',
      })({ organizationId, lastPost });
    }
  }

  if (patched('reminder')) {
    for (const user of userOrgs.users) {
      if (!user.user.sendStreakEmails) {
        continue;
      }
      await sendEmailAsync(
        user.user.email,
        'Streak Ended',
        '<p>Your streak has ended! You didn\\'t post anything in the last 24 hours. Schedule a post now to start a new streak!</p>',
        'bottom'
      );
    }
  }
  await setStreak(organizationId, 'end');`,
      },
      {
        // streakWorkflowV2 is only the continue-as-new target name; the
        // emitting run never needs its implementation.
        find: `export async function streakWorkflow({`,
        replace: `const DAY = 86400000;

export async function streakWorkflow({`,
      },
      {
        // Harness-only placeholder. streakWorkflowV2 is a workflow type that
        // only exists after the upgrade, so no pre-upgrade history can target
        // it; it is exported here only so the test server can start the
        // continue-as-new target instead of retrying a failing task forever
        // (which stops time skipping). Its history is never captured.
        find: `  await setStreak(organizationId, 'end');
}`,
        replace: `  await setStreak(organizationId, 'end');
}

export async function streakWorkflowV2(_args: {
  organizationId: string;
  lastPost?: number;
}): Promise<void> {
  return;
}`,
      },
    ],
  },
];

function applyEdits(source, edits, file) {
  let result = source;
  for (const edit of edits) {
    const occurrences = result.split(edit.find).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `derive-patched: anchor for ${file} matched ${occurrences} times (expected 1):\n${edit.find.split('\n')[0]}`
      );
    }
    result = result.replace(edit.find, edit.replace);
  }
  return result;
}

/** Returns `{ 'workflows/x.ts': source }` for the derived patched bundle. */
export function derivePatchedSources() {
  const baseDir = join(LEGACY_DIR, 'base/workflows');
  const sources = {};

  // Everything except the three same-named patched workflows is a byte copy.
  for (const file of [
    'index.ts',
    'digest.email.workflow.ts',
    'refresh.token.workflow.ts',
    'send.email.workflow.ts',
    'post-workflows/post.workflow.v1.0.1.ts',
    'post-workflows/post.workflow.v1.0.2.ts',
  ]) {
    sources[join('workflows', file)] = readFileSync(join(baseDir, file), 'utf8');
  }

  for (const transform of transforms) {
    const base = readFileSync(join(baseDir, transform.file), 'utf8');
    sources[join('workflows', transform.file)] = applyEdits(base, transform.edits, transform.file);
  }

  // Signals stay the pre-upgrade contract in both bundles.
  for (const signal of ['email.signal.ts', 'send.email.signal.ts']) {
    sources[join('signals', signal)] = readFileSync(join(LEGACY_DIR, 'base/signals', signal), 'utf8');
  }

  return sources;
}

/**
 * Writes the derived bundle to `legacy/patched/` and refuses to continue if the
 * committed copy has drifted (that would change what already-produced fixtures
 * were generated from). `refresh` rewrites the committed copy instead.
 */
export function materialisePatched({ refresh = false } = {}) {
  const sources = derivePatchedSources();
  const drifted = [];

  for (const [relativePath, source] of Object.entries(sources)) {
    const target = join(LEGACY_DIR, 'patched', relativePath);
    if (refresh) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
      continue;
    }
    if (!existsSync(target) || readFileSync(target, 'utf8') !== source) {
      drifted.push(relativePath);
    }
  }

  if (drifted.length) {
    throw new Error(
      `legacy/patched is out of date with legacy/base (${drifted.join(', ')}).\n` +
        `Regenerate it deliberately with: node run.mjs generate --refresh-legacy`
    );
  }

  return sources;
}
