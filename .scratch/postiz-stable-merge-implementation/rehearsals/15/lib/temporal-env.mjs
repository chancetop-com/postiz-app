/**
 * Ephemeral Temporal server for the rehearsal.
 *
 * `@temporalio/testing` starts a real Temporal server binary. Two flavours:
 *   - `local`        — real clock; used where the scenario must observe a post
 *                      waiting, a worker restart, and a later publish;
 *   - `time-skipping` — used only for the hourly/daily maintenance workflows so
 *                      the rehearsal does not wait a day.
 *
 * The namespace and the search attributes the candidate writes are registered
 * the same way an operator does it, so `workflow.list({query})` behaves like
 * the deployed namespace.
 */
import pkg from '@temporalio/proto';
import { TestWorkflowEnvironment } from '@temporalio/testing';

const { temporal } = pkg;
const TEXT = temporal.api.enums.v1.IndexedValueType.INDEXED_VALUE_TYPE_TEXT;

export async function startTemporal({ timeSkipping = false } = {}) {
  const env = timeSkipping
    ? await TestWorkflowEnvironment.createTimeSkipping()
    : await TestWorkflowEnvironment.createLocal();

  await env.connection.operatorService.addSearchAttributes({
    namespace: 'default',
    searchAttributes: {
      postId: TEXT,
      organizationId: TEXT,
    },
  });

  return {
    env,
    address: env.address,
    client: env.client,
    nativeConnection: env.nativeConnection,
    async close() {
      await env.teardown();
    },
  };
}

/** Runs `fn` until it returns a truthy value or the timeout expires. */
export async function waitFor(fn, { timeoutMs = 60_000, intervalMs = 500, label = 'condition' } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timeout waiting for ${label} (last=${JSON.stringify(last)})`);
}

function readSearchAttributes(description) {
  const result = {};

  // Most servers return the untyped map; values are arrays of typed scalars.
  const raw = description.searchAttributes;
  if (raw) {
    for (const [key, value] of Object.entries(raw)) {
      result[key] = Array.isArray(value) && value.length === 1 ? value[0] : value;
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
      result[key] = Array.isArray(value) && value.length === 1 ? value[0] : value;
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

/**
 * Summarises the events that matter for continuity: workflow type, timer and
 * activity dispatch, and how the run ended. Payload bytes are not decoded here
 * — the stub provider records the payload contract it actually received.
 */
const EVENT_TYPE_NAMES = Object.fromEntries(
  Object.entries(temporal.api.enums.v1.EventType)
    .filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => [value, name])
);

const eventName = (value) =>
  typeof value === 'string' ? value : EVENT_TYPE_NAMES[value] ?? `EVENT_TYPE_${value}`;

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
          e.startChildWorkflowExecutionInitiatedEventAttributes.workflowType?.name,
        workflowId: e.startChildWorkflowExecutionInitiatedEventAttributes.workflowId,
      })),
    continuedAsNew: events.filter(
      (e) => e.workflowExecutionContinuedAsNewEventAttributes
    ).length,
  };
}
