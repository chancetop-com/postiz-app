/**
 * Thin HTTP clients for the two real entry points the rehearsal drives:
 *   - the public API (`/public/v1`, API-key auth), and
 *   - the dashboard session routes (`auth` JWT + `showorg`).
 */
import jwt from 'jsonwebtoken';
const { sign } = jwt;

export function sessionHeaders({ userId, organizationId, jwtSecret }) {
  return {
    auth: sign({ id: userId }, jwtSecret),
    showorg: organizationId,
  };
}

const json = async (response) => {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
};

export async function uploadMedia({ origin, apiKey, buffer, name }) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'image/png' }), name);
  const response = await fetch(`${origin}/public/v1/upload`, {
    method: 'POST',
    headers: { authorization: apiKey },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  return json(response);
}

export async function createScheduledPost({
  origin,
  apiKey,
  integrationId,
  date,
  content,
  media,
  type = 'schedule',
  settings = { __type: 'bluesky' },
}) {
  const response = await fetch(`${origin}/public/v1/posts`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      type,
      shortLink: false,
      date,
      tags: [],
      posts: [
        {
          integration: { id: integrationId },
          settings,
          value: [
            {
              content,
              image: media ? [media] : [],
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  return json(response);
}

export async function changeDate({ origin, headers, postId, date, action = 'schedule' }) {
  const response = await fetch(`${origin}/posts/${postId}/date`, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ date, action, ...(action === 'schedule' ? { republish: true } : {}) }),
    signal: AbortSignal.timeout(20_000),
  });
  return json(response);
}

export async function changeStatus({ origin, apiKey, postId, status }) {
  const response = await fetch(`${origin}/public/v1/posts/${postId}/status`, {
    method: 'PUT',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
    signal: AbortSignal.timeout(20_000),
  });
  return json(response);
}

export async function deletePost({ origin, apiKey, postId }) {
  const response = await fetch(`${origin}/public/v1/posts/${postId}`, {
    method: 'DELETE',
    headers: { authorization: apiKey },
    signal: AbortSignal.timeout(20_000),
  });
  return json(response);
}

export async function getPost({ origin, apiKey, postId }) {
  const response = await fetch(`${origin}/public/v1/posts/${postId}`, {
    headers: { authorization: apiKey },
    signal: AbortSignal.timeout(20_000),
  });
  return json(response);
}
