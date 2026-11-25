export class UploadHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function uploadJson(response: Response, failure?: string) {
  if (!response.ok) {
    throw new UploadHttpError(
      response.status,
      failure ?? (await response.text().catch(() => ''))
    );
  }
  return response.json();
}

// Both fetch and reading its response body can fail after the server saved the
// file. Recover using the same upload identity, including on a truncated 2xx.
export async function recoverUploadCompletion<T>(
  complete: () => Promise<T>,
  recover: () => Promise<T>,
  signal?: AbortSignal,
  retryDelays: number[] = [0]
) {
  let attempt = complete;
  for (const delay of retryDelays) {
    try {
      return await attempt();
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof UploadHttpError &&
          error.status < 500 &&
          error.status !== 408)
      ) {
        throw error;
      }
    }
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    signal?.throwIfAborted();
    attempt = recover;
  }
  return attempt();
}
