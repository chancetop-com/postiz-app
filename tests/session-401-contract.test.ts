import { describe, expect, it, vi } from 'vitest';
import { removeAuth } from '@gitroom/backend/services/auth/auth.middleware';
import { UsersController } from '@gitroom/backend/api/routes/users.controller';

/**
 * Ticket 05: the server side of the 401/logout handshake.
 *
 * A rejected identity answers 401 and clears the legacy cookie while sending
 * `logout: true`; the browser-side layout reacts to that header. The ordinary
 * client logout button does not call this route. Both paths stay separate.
 */

process.env.FRONTEND_URL = 'http://localhost:4200';

const response = () => {
  const headers: Record<string, string> = {};
  const cookies: { name: string; value: string; options: any }[] = [];
  const res = {
    header(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return res;
    },
    cookie(name: string, value: string, options: any) {
      cookies.push({ name, value, options });
      return res;
    },
    status() {
      return res;
    },
    send() {
      return res;
    },
  };
  return { res, headers, cookies };
};

describe('401/logout response contract', () => {
  it('signals logout and expires the legacy auth cookie', () => {
    const { res, headers, cookies } = response();

    removeAuth(res as never);

    expect(headers.logout).toBe('true');
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: 'auth',
      value: '',
      options: expect.objectContaining({ maxAge: -1 }),
    });
  });

  it('POST /user/logout answers with the logout header but no cookie change', () => {
    const { res, headers, cookies } = response();
    const controller = new UsersController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    controller.logout(res as never);

    expect(headers.logout).toBe('true');
    expect(cookies).toHaveLength(0);
  });
});
