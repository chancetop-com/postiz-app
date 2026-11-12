import {
  makeContinueAsNewFunc,
  patched,
  proxyActivities,
  sleep,
} from '@temporalio/workflow';
import { EmailActivity } from '@gitroom/orchestrator/activities/email.activity';

const { sendEmailAsync, getUserOrgs, setStreak, getLastPublishDate } =
  proxyActivities<EmailActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: 'main',
  cancellationType: 'ABANDON',
});

const DAY = 86400000;

export async function streakWorkflow({
  organizationId,
}: {
  organizationId: string;
}) {
  await setStreak(organizationId, 'start');
  await sleep(79200000);
  const userOrgs = await getUserOrgs(organizationId);

  if (!patched('reminder')) {
    for (const user of userOrgs.users) {
    if (!user.user.sendStreakEmails) {
      continue;
    }
    await sendEmailAsync(
      user.user.email,
      'Streak Reminder',
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
        '<p>Your streak has ended! You didn\'t post anything in the last 24 hours. Schedule a post now to start a new streak!</p>',
        'bottom'
      );
    }
  }
  await setStreak(organizationId, 'end');
}

export async function streakWorkflowV2(_args: {
  organizationId: string;
  lastPost?: number;
}): Promise<void> {
  return;
}
