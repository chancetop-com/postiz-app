/**
 * Public-API client additions for ticket 16.
 *
 * Ticket 15's helper covers a single scheduled post; this one also sends the
 * top-level repeat interval and a root+comment value list, both of which are
 * supported by the existing public API DTO.
 */
export { sessionHeaders } from '../../15/lib/api.mjs';

const json = async (response) => {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
};

export async function createPublicPost({
  origin,
  apiKey,
  integrationId,
  date,
  values,
  inter,
  type = 'schedule',
}) {
  const response = await fetch(`${origin}/public/v1/posts`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      type,
      shortLink: false,
      date,
      ...(inter ? { inter } : {}),
      tags: [],
      posts: [
        {
          integration: { id: integrationId },
          settings: { __type: 'bluesky' },
          value: values,
        },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  return json(response);
}
