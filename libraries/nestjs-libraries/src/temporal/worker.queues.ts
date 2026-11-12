/**
 * Which task queues may run workflow tasks.
 *
 * Workflows live on `main`. Provider queues run activities only, because the
 * deployment history of a real installation can contain old workflow
 * executions on a provider queue; an operator that finds such executions must
 * opt that queue in with `COMPAT_WORKFLOW_QUEUES` so a compatible worker
 * registers the same workflow bundle there (ticket 16).
 *
 * This must stay an explicit opt-in: setting it on a queue that only carries
 * activities is harmless, but leaving it unset keeps the new activity-only
 * shape for every provider queue.
 */
export function parseCompatWorkflowQueues(
  value: string | undefined = process.env.COMPAT_WORKFLOW_QUEUES
): string[] {
  return Array.from(
    new Set(
      (value || '')
        .split(',')
        .map((queue) => queue.trim())
        .filter(Boolean)
    )
  );
}

export function queueRunsWorkflows(
  taskQueue: string,
  compatQueues: string[]
): boolean {
  return taskQueue === 'main' || compatQueues.includes(taskQueue);
}
