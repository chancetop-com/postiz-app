import { HttpException, Injectable } from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

interface ConnectLink {
  org: string;
  integration: string;
  redirectUrl?: string;
  redirectTo?: string;
}

const lifetime = 3600;

@Injectable()
export class ConnectLinkRepository {
  storeLink(token: string, link: ConnectLink) {
    return ioRedis.set(
      `connectLink:${token}`,
      JSON.stringify(link),
      'EX',
      lifetime
    );
  }

  async loadLink(token: string): Promise<ConnectLink> {
    const value = await ioRedis.get(`connectLink:${token}`);
    if (!value)
      throw new HttpException(
        'This connection link expired, please ask for a new one',
        404
      );
    return JSON.parse(value);
  }

  startAuthorization(state: string, token: string, codeVerifier: string) {
    return ioRedis.set(
      `connectOAuth:${state}`,
      JSON.stringify({ token, codeVerifier }),
      'EX',
      lifetime
    );
  }

  async claimAuthorization(state: string, provider: string) {
    const key = `connectOAuth:${state}`;
    const value = await ioRedis.get(key);
    if (!value) return undefined;
    const { token, codeVerifier } = JSON.parse(value) as {
      token: string;
      codeVerifier: string;
    };
    const link = await this.loadLink(token);
    if (link.integration !== provider || !(await ioRedis.del(key))) {
      throw new HttpException(
        'Invalid connection state for this provider',
        400
      );
    }
    return { ...link, token, codeVerifier };
  }

  storeSelection(state: string, id: string, value: string) {
    return ioRedis.set(
      `connectSelection:${state}:${id}`,
      value,
      'EX',
      lifetime
    );
  }

  async readSelection(state: string, id: string) {
    const value = await ioRedis.get(`connectSelection:${state}:${id}`);
    if (!value)
      throw new HttpException(
        'This selection expired. Open the connection link again.',
        400
      );
    return value;
  }

  async consumeSelection(state: string, id: string) {
    if (!(await ioRedis.del(`connectSelection:${state}:${id}`))) {
      throw new HttpException('This selection was already used', 400);
    }
  }
}
