/**
 * A worker that runs the candidate workflow bundle but registers only one
 * activity.
 *
 * This is the rollback-coverage probe for "an activity class that is not
 * registered" (an undecorated `@ActivityMethod()`): the execution is picked up,
 * the activity task fails with "Activity function refreshToken is not
 * registered on this Worker", and no mutation runs. The real orchestrator
 * cannot be used for the negative half because its activity map is assembled by
 * nestjs-temporal-core from the decorated classes; trimming the registration set
 * here models a worker that does not have the method.
 *
 * The SDK logs the missing registration to `console.error` in this process; the
 * probe taps that line so the scenario can assert the cause, not just the
 * symptom.
 */
import { NativeConnection, Worker } from '@temporalio/worker';
import { COMPILED_WORKFLOWS } from './paths.mjs';

export async function startIncompleteRefreshWorker({ address, prisma }) {
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    taskQueue: 'main',
    workflowsPath: COMPILED_WORKFLOWS,
    activities: {
      // The workflow needs this before it reaches the missing activity.
      getIntegrationsById: async (id, orgId) =>
        prisma.integration.findFirst({ where: { id, organizationId: orgId } }),
      // refreshToken is deliberately absent.
    },
  });

  const logs = [];
  // The SDK's DefaultLogger writes straight to process.stderr; tap that stream
  // while the probe runs so the scenario can assert the cause.
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    const text = String(chunk);
    if (/not registered/i.test(text)) logs.push(text);
    return originalWrite(chunk, ...rest);
  };

  const run = worker.run().catch((err) => {
    originalWrite(`[ticket17] incomplete worker stopped: ${err?.message ?? err}\n`);
  });
  let stopped = false;

  return {
    logs,
    async stop() {
      if (stopped) return;
      stopped = true;
      worker.shutdown();
      await run;
      process.stderr.write = originalWrite;
      await connection.close().catch(() => {});
    },
  };
}
