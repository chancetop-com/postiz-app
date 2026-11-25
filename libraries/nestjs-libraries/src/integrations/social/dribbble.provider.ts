import { getMediaFilename } from '@gitroom/helpers/utils/media.upload';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import {
  AnalyticsData,
  AuthTokenDetails,
  PendingCheckResponse,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import FormData from 'form-data';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { DribbbleDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/dribbble.dto';
import mime from 'mime-types';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';

export class DribbbleProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // Dribbble has moderate API limits
  identifier = 'dribbble';
  name = 'Dribbble';
  isBetweenSteps = false;
  scopes = ['public', 'upload'];
  editor = 'normal' as const;
  maxLength() {
    return 40000;
  }
  dto = DribbbleDto;

  override async checkValidity([firstItem]: Array<ValidityMedia[]>): Promise<
    string | true
  > {
    const isMp4 = firstItem?.find(
      (item) => hasExtension(item?.path, 'mp4')
    );
    if (firstItem?.length !== 1) {
      return 'Requires one item';
    }
    if (isMp4) {
      return 'Does not support mp4 files';
    }
    const details = await this.getImageDimensions(firstItem?.[0]?.path);
    if (
      (details?.width === 400 && details?.height === 300) ||
      (details?.width === 800 && details?.height === 600)
    ) {
      return true;
    }
    return 'Invalid image size. Requires 400x300 or 800x600 px images.';
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    const { access_token, expires_in } = await (
      await this.fetch('https://api-sandbox.pinterest.com/v5/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${process.env.PINTEREST_CLIENT_ID}:${process.env.PINTEREST_CLIENT_SECRET}`
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: `${this.scopes.join(',')}`,
          redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/pinterest`,
        }),
      })
    ).json();

    const { id, profile_image, username } = await (
      await this.fetch('https://api-sandbox.pinterest.com/v5/user_account', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      id: id,
      name: username,
      accessToken: access_token,
      refreshToken: refreshToken,
      expiresIn: expires_in,
      picture: profile_image || '',
      username,
    };
  }

  @Tool({ description: 'Teams list', dataSchema: [] })
  async teams(accessToken: string) {
    const { teams } = await (
      await this.fetch('https://api.dribbble.com/v2/user', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
    ).json();

    return (
      teams?.map((team: any) => ({
        id: team.id,
        name: team.name,
      })) || []
    );
  }

  async generateAuthUrl() {
    const state = makeSecureId(6);
    return {
      url: `https://dribbble.com/oauth/authorize?client_id=${
        process.env.DRIBBBLE_CLIENT_ID
      }&redirect_uri=${encodeURIComponent(
        `${process.env.FRONTEND_URL}/integrations/social/dribbble`
      )}&response_type=code&scope=${this.scopes.join('+')}&state=${state}`,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh: string;
  }) {
    const { access_token, scope } = await (
      await this.fetch(
        `https://dribbble.com/oauth/token?client_id=${process.env.DRIBBBLE_CLIENT_ID}&client_secret=${process.env.DRIBBBLE_CLIENT_SECRET}&code=${params.code}&redirect_uri=${process.env.FRONTEND_URL}/integrations/social/dribbble`,
        {
          method: 'POST',
        }
      )
    ).json();

    this.checkScopes(this.scopes, scope);

    const { id, name, avatar_url, login } = await (
      await this.fetch('https://api.dribbble.com/v2/user', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      id: id,
      name,
      accessToken: access_token,
      refreshToken: '',
      expiresIn: 999999999,
      picture: avatar_url,
      username: login,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<DribbbleDto>[]
  ): Promise<PostResponse[]> {
    return this.createShot(accessToken, postDetails, false);
  }

  async postPending(
    id: string,
    accessToken: string,
    postDetails: PostDetails<DribbbleDto>[]
  ): Promise<PostResponse[]> {
    return this.createShot(accessToken, postDetails, true);
  }

  private async createShot(
    accessToken: string,
    postDetails: PostDetails<DribbbleDto>[],
    allowPending: boolean
  ): Promise<PostResponse[]> {
    const { data } = await this.getSsrfSafeAxios().get(
      postDetails?.[0]?.media?.[0]?.path!,
      {
        responseType: 'stream',
      }
    );

    const filename = getMediaFilename(postDetails?.[0]?.media?.[0]?.path);

    const formData = new FormData();
    formData.append('image', data, {
      filename,
      contentType: mime.lookup(filename) || '',
    });

    formData.append('title', postDetails[0].settings.title);
    formData.append('description', postDetails[0].message);

    let data2;
    try {
      data2 = await this.getSsrfSafeAxios().post(
        'https://api.dribbble.com/v2/shots',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
    } catch (err: any) {
      const status = err?.response?.status;
      if (
        ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE'].includes(err?.code)
      ) {
        throw new BadBody(
          this.identifier,
          '{}',
          '{}',
          'The connection closed before Dribbble confirmed the shot. Check your shots before publishing again.',
          'unconfirmed'
        );
      }
      if (status >= 400 && status < 500 && status !== 429) {
        throw new BadBody(
          this.identifier,
          JSON.stringify(err?.response?.data ?? {}),
          '{}',
          err?.response?.data?.message ||
            `Dribbble rejected the shot with status ${status}`
        );
      }
      throw err;
    }

    const newId = data2.headers.location?.match(
      /\/shots\/(\d+)\/?(?:[?#].*)?$/
    )?.[1];
    if (!newId) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'Dribbble accepted the shot without a tracking ID. Check your shots before publishing again.',
        'unconfirmed'
      );
    }
    const pending = allowPending && data2.status === 202;

    return [
      {
        id: postDetails?.[0]?.id,
        status: pending ? 'pending' : 'completed',
        ...(pending && { pendingData: { shotId: newId } }),
        postId: newId,
        releaseURL: `https://dribbble.com/shots/${newId}`,
      },
    ];
  }

  override async checkPostStatus(
    accessToken: string,
    pendingData: { shotId: string }
  ): Promise<PendingCheckResponse> {
    const { data, status } = await this.getSsrfSafeAxios().get(
      `https://api.dribbble.com/v2/shots/${encodeURIComponent(
        pendingData.shotId
      )}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
      }
    );
    // A new shot returns 404 until the image has finished processing.
    if (status === 404 || status === 429 || status >= 500) {
      return { status: 'pending', pendingData };
    }
    if (status === 401) {
      throw new RefreshToken(this.identifier, JSON.stringify(data), '{}');
    }
    if (status !== 200) {
      throw new BadBody(
        this.identifier,
        JSON.stringify(data),
        '{}',
        data?.message ||
          `Dribbble rejected the shot lookup with status ${status}`,
        'unconfirmed'
      );
    }
    return {
      status: 'completed',
      postId: pendingData.shotId,
      releaseURL:
        data.html_url || `https://dribbble.com/shots/${pendingData.shotId}`,
    };
  }

  analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    return Promise.resolve([]);
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    // Dribbble doesn't provide detailed post-level analytics via their API
    return [];
  }
}
