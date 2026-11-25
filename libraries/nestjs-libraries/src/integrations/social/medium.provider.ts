import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { setHeartbeatDetails } from '@gitroom/nestjs-libraries/temporal/temporal.heartbeat';
import { Integration } from '@prisma/client';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { MediumSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/medium.settings.dto';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';

export class MediumProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // Medium has lenient publishing limits
  identifier = 'medium';
  name = 'Medium';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'markdown' as const;
  dto = MediumSettingsDto;
  maxLength() {
    return 100000;
  }

  async generateAuthUrl() {
    const state = makeSecureId(6);
    return {
      url: state,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async customFields() {
    return [
      {
        key: 'apiKey',
        label: 'API key',
        validation: `/^.{3,}$/`,
        type: 'password' as const,
      },
    ];
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const body = JSON.parse(Buffer.from(params.code, 'base64').toString());
    try {
      const {
        data: { name, id, imageUrl, username },
      } = await (
        await fetch('https://api.medium.com/v1/me', {
          headers: {
            Authorization: `Bearer ${body.apiKey}`,
          },
        })
      ).json();

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: body.apiKey,
        id,
        name,
        picture: imageUrl || '',
        username,
      };
    } catch (err) {
      return 'Invalid credentials';
    }
  }

  @Tool({ description: 'List of publications', dataSchema: [] })
  async publications(accessToken: string, _: any, id: string) {
    const { data } = await (
      await fetch(`https://api.medium.com/v1/users/${id}/publications`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
    ).json();

    return data;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<MediumSettingsDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const { settings } = postDetails[0];
    const url = settings?.publication
      ? `https://api.medium.com/v1/publications/${encodeURIComponent(
          settings.publication
        )}/posts`
      : `https://api.medium.com/v1/users/${encodeURIComponent(id)}/posts`;
    const body = JSON.stringify({
      title: settings.title,
      contentFormat: 'markdown',
      content: postDetails[0].message,
      ...(settings.canonical ? { canonicalUrl: settings.canonical } : {}),
      ...(settings?.tags?.length
        ? { tags: settings.tags.map((p) => p.value) }
        : {}),
      publishStatus: settings.publication ? 'draft' : 'public',
    });
    const unconfirmed = (detail: string) =>
      new BadBody(
        this.identifier,
        detail,
        body,
        'Medium did not confirm the article. Check your stories before publishing again.',
        'unconfirmed'
      );

    // A failed response can arrive after Medium has created the article.
    setHeartbeatDetails('medium: create article');
    let response: Response;
    let raw: string;
    try {
      response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      raw = await response.text();
    } catch (error) {
      throw unconfirmed(
        error instanceof Error ? error.message : 'Connection lost'
      );
    }
    if (response.status >= 500 || response.status === 408)
      throw unconfirmed(raw);
    if (response.status === 401)
      throw new RefreshToken(this.identifier, raw, body);
    if (!response.ok)
      throw new BadBody(
        this.identifier,
        raw,
        body,
        `Medium rejected the article (HTTP ${response.status}).`
      );
    let data: { id?: string; url?: string } | undefined;
    try {
      data = JSON.parse(raw)?.data;
    } catch {
      throw unconfirmed(raw);
    }
    if (!data?.id || !data?.url) throw unconfirmed(raw);

    return [
      {
        id: postDetails?.[0].id,
        status: 'completed',
        postId: data.id,
        releaseURL: data.url,
      },
    ];
  }
}
