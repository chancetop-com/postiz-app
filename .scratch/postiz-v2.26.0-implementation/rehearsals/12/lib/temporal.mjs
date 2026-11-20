/**
 * Helpers for the isolated Temporal server at TEMPORAL_ADDRESS.
 *
 * The server is real (not a test server), so the rehearsal can observe the
 * namespace, task-queue pollers, workflow ids and histories the same way an
 * operator would. Every execution is synthetic.
 */
import pkg from '@temporalio/proto';
import { Client, Connection } from '@temporalio/client';

const { temporal } = pkg;
const TEXT = temporal.api.enums.v1.IndexedValueType.INDEXED_VALUE_TYPE_TEXT;

export async function connectTemporal({ address, namespace = 'default' }) {
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });

  // Deterministic searches used by the candidate activities. An operator
  // registers these once per namespace; ignore "already exists" so repeated
  // runs against the same isolated server are idempotent.
  try {
    await connection.operatorService.addSearchAttributes({
      namespace,
      searchAttributes: {
        postId: TEXT,
        organizationId: TEXT,
      },
    });
  } catch (err) {
    if (!/already exists|ALREADY_EXISTS/i.test(String(err?.message))) {
      throw err;
    }
  }

  return {
    address,
    namespace,
    connection,
    client,
    async close() {
      await connection.close();
    },
  };
}

/** Runs `fn` until it returns a truthy value or the timeout expires. */
export async function waitFor(
  fn,
  { timeoutMs = 60_000, intervalMs = 500, label = 'condition' } = {}
) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `timeout waiting for ${label} (last=${JSON.stringify(last)})`
  );
}

function readSearchAttributes(description) {
  const result = {};
  const raw = description.searchAttributes;
  if (raw) {
    for (const [key, value] of Object.entries(raw)) {
      result[key] =
        Array.isArray(value) && value.length === 1 ? value[0] : value;
    }
  }
  if (Object.keys(result).length) return result;

  const attributes = description.typedSearchAttributes;
  if (!attributes) return result;
  const add = (key, value) => {
    result[key?.name ?? String(key)] = value;
  };
  if (typeof attributes.forEach === 'function' && !Array.isArray(attributes)) {
    attributes.forEach((value, key) => add(key, value));
  } else if (typeof attributes[Symbol.iterator] === 'function') {
    for (const [key, value] of attributes) add(key, value);
  } else if (attributes.searchAttributes) {
    for (const [key, value] of Object.entries(attributes.searchAttributes)) {
      result[key] =
        Array.isArray(value) && value.length === 1 ? value[0] : value;
    }
  }
  return result;
}

export async function describeWorkflow(client, workflowId, runId) {
  try {
    const handle = client.workflow.getHandle(workflowId, runId);
    const description = await handle.describe();
    return {
      workflowId: description.workflowId,
      runId: description.runId,
      firstExecutionRunId: handle.firstExecutionRunId,
      type: description.type,
      status: description.status.name,
      taskQueue: description.taskQueue,
      searchAttributes: readSearchAttributes(description),
    };
  } catch (err) {
    return { workflowId, runId, error: err.message };
  }
}

export async function listExecutions(client, query) {
  const results = [];
  for await (const info of client.workflow.list({ query })) {
    results.push({
      workflowId: info.workflowId,
      runId: info.runId,
      type: info.type,
      status: info.status.name,
      taskQueue: info.taskQueue,
      startTime: info.startTime?.toISOString?.() ?? null,
    });
  }
  return results;
}

const EVENT_TYPE_NAMES = Object.fromEntries(
  Object.entries(temporal.api.enums.v1.EventType)
    .filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => [value, name])
);

const eventName = (value) =>
  typeof value === 'string'
    ? value
    : EVENT_TYPE_NAMES[value] ?? `EVENT_TYPE_${value}`;

export function historyEvents(history) {
  return (history.events || []).map((event) => ({
    type: eventName(event.eventType),
    raw: event,
  }));
}

export async function historySummary(client, workflowId, runId) {
  const handle = client.workflow.getHandle(workflowId, runId);
  const history = await handle.fetchHistory();
  const events = history.events || [];
  const types = events.map((event) => event.eventType);
  return {
    workflowId,
    runId,
    eventCount: events.length,
    eventTypes: types.map(eventName),
    firstEvent: eventName(types[0]),
    lastEvent: eventName(types[types.length - 1]),
    timers: events.filter((e) => e.timerStartedEventAttributes).length,
    activityScheduled: events
      .filter((e) => e.activityTaskScheduledEventAttributes)
      .map((e) => ({
        activity: e.activityTaskScheduledEventAttributes.activityType?.name,
        taskQueue: e.activityTaskScheduledEventAttributes.taskQueue?.name,
      })),
    childWorkflows: events
      .filter((e) => e.startChildWorkflowExecutionInitiatedEventAttributes)
      .map((e) => ({
        workflowType:
          e.startChildWorkflowExecutionInitiatedEventAttributes.workflowType
            ?.name,
        workflowId:
          e.startChildWorkflowExecutionInitiatedEventAttributes.workflowId,
      })),
    signalWithStart: events
      .filter((e) => e.workflowExecutionSignaledEventAttributes)
      .map((e) => e.workflowExecutionSignaledEventAttributes.signalName),
    continuedAsNew: events.filter(
      (e) => e.workflowExecutionContinuedAsNewEventAttributes
    ).length,
    terminated: events.filter(
      (e) => e.workflowExecutionTerminatedEventAttributes
    ).length,
  };
}

/**
 * Number of pollers for a task queue by type, including the workflow poller a
 * `COMPAT_WORKFLOW_QUEUES` entry adds. The server returns identities, so the
 * evidence can show which queue types are actually polled.
 */
export async function taskQueuePollers(
  client,
  taskQueue,
  taskQueueType = 'WORKFLOW',
  namespace = 'default'
) {
  const response = await client.workflowService.describeTaskQueue({
    namespace,
    taskQueue: { name: taskQueue },
    taskQueueType:
      temporal.api.enums.v1.TaskQueueType[
        `TASK_QUEUE_TYPE_${taskQueueType}`
      ],
  });
  return (response.pollers || []).map((poller) => ({
    identity: poller.identity,
    lastAccessTime: poller.lastAccessTime?.toISOString?.() ?? null,
    ratePerSecond: poller.ratePerSecond,
  }));
}

export async function terminateIfRunning(client, workflowId, reason) {
  try {
    const handle = client.workflow.getHandle(workflowId);
    const description = await handle.describe();
    if (description.status.name === 'RUNNING') {
      await handle.terminate(reason);
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}
