export interface BrowserTiming {
  prepareAt: string | null;
  uploadAt: string;
  publishSeconds: number;
  heartbeatSeconds: number;
  querySeconds: number;
  queryRounds: number;
  queryWaitSeconds: number;
}

function integer(name: string, fallback: number, minimum = 1) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${name} must be an integer >= ${minimum}`);
  return value;
}

export function occurrenceTiming(due: Date, immediate: boolean): BrowserTiming {
  const downloadLead = integer('BROWSER_PREDOWNLOAD_LEAD_SECONDS', 0, 0);
  const uploadLead = integer('BROWSER_UPLOAD_LEAD_SECONDS', 0, 0);
  const before = (seconds: number) =>
    new Date(due.getTime() - seconds * 1000).toISOString();
  return {
    prepareAt:
      !immediate && downloadLead > uploadLead ? before(downloadLead) : null,
    uploadAt: before(immediate ? 0 : uploadLead),
    publishSeconds: integer('BROWSER_PUBLISH_ACTIVITY_SECONDS', 1800),
    heartbeatSeconds: integer('BROWSER_PUBLISH_HEARTBEAT_SECONDS', 180),
    querySeconds: integer('BROWSER_RESULT_QUERY_SECONDS', 120),
    queryRounds: integer('BROWSER_RESULT_QUERY_ROUNDS', 90),
    queryWaitSeconds: integer('BROWSER_RESULT_QUERY_WAIT_SECONDS', 20),
  };
}
