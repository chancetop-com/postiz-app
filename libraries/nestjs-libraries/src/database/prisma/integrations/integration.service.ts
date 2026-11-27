import {
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  IntegrationRepository,
  ConnectLinkBinding,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { ConnectLinkRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/connect.link.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  AnalyticsData,
  AuthTokenDetails,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { Integration, Organization } from '@prisma/client';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import dayjs from 'dayjs';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  NotEnoughScopes,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { IntegrationTimeDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.time.dto';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { PlugDto } from '@gitroom/nestjs-libraries/dtos/plugs/plug.dto';
import { difference, uniq } from 'lodash';
import utc from 'dayjs/plugin/utc';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { TemporalService } from 'nestjs-temporal-core';
import { randomBytes } from 'crypto';
import { ApplicationFailure } from '@temporalio/common';
import {
  EncryptionService,
  integrationEncryptedFields,
} from '@gitroom/nestjs-libraries/services/encryption.service';
import { isReusableRefreshCredential } from '@gitroom/nestjs-libraries/integrations/refresh.credential';

interface ConnectPage {
  id: string;
  name: string;
  username?: string;
  pageId?: string;
  locationName?: string;
  accountName?: string;
  picture?: string | { data: { url: string } };
  address?: string;
  subscriberCount?: string;
}

interface PendingConnectSelection {
  token: string;
  auth: AuthTokenDetails;
  pages: ConnectPage[];
  timezone: number;
  authorizedAt: number;
}

dayjs.extend(utc);

@Injectable()
export class IntegrationService {
  private storage = UploadFactory.createStorage();
  constructor(
    private _integrationRepository: IntegrationRepository,
    private _autopostsRepository: AutopostRepository,
    private _integrationManager: IntegrationManager,
    private _notificationService: NotificationService,
    @Inject(forwardRef(() => RefreshIntegrationService))
    private _refreshIntegrationService: RefreshIntegrationService,
    private _temporalService: TemporalService,
    private _encryptionService: EncryptionService,
    private readonly connectLinks: ConnectLinkRepository
  ) {}

  async changeActiveCron(orgId: string) {
    const data = await this._autopostsRepository.getAutoposts(orgId);

    for (const item of data.filter((f) => f.active)) {
      try {
        await this._temporalService.terminateWorkflow(`autopost-${item.id}`);
      } catch (err) {}
    }

    return true;
  }

  getMentions(platform: string, q: string) {
    return this._integrationRepository.getMentions(platform, q);
  }

  insertMentions(
    platform: string,
    mentions: { name: string; username: string; image: string }[]
  ) {
    return this._integrationRepository.insertMentions(platform, mentions);
  }

  async setTimes(
    orgId: string,
    integrationId: string,
    times: IntegrationTimeDto
  ) {
    return this._integrationRepository.setTimes(orgId, integrationId, times);
  }

  updateProviderSettings(org: string, id: string, additionalSettings: string) {
    return this._integrationRepository.updateProviderSettings(
      org,
      id,
      additionalSettings
    );
  }

  checkPreviousConnections(org: string, id: string) {
    return this._integrationRepository.checkPreviousConnections(org, id);
  }

  private async storeProfilePicture(
    merchantId: string,
    picture?: string,
    currentPicture?: string
  ) {
    if (!picture) return picture;

    if (process.env.STORAGE_PROVIDER === 'azure') {
      // Reuse a path already saved for this organization's channel.
      if (
        picture === currentPicture &&
        !/[?#]/.test(picture) &&
        this.storage.publicUrl &&
        picture.startsWith(this.storage.publicUrl(''))
      ) {
        return picture;
      }
    } else {
      const hosted = [
        process.env.FRONTEND_URL,
        process.env.CLOUDFLARE_BUCKET_URL,
        'https://imagedelivery.net',
      ];
      if (
        hosted.some(
          (base) => base && picture.startsWith(base.replace(/\/$/, '') + '/')
        )
      ) {
        return picture;
      }
    }

    return this.storage.uploadSimple(picture, merchantId);
  }

  async createOrUpdateIntegration(
    additionalSettings:
      | {
          title: string;
          description: string;
          type: 'checkbox' | 'text' | 'textarea';
          value: any;
          regex?: string;
        }[]
      | undefined,
    oneTimeToken: boolean,
    org: string,
    name: string,
    picture: string | undefined,
    type: 'article' | 'social',
    internalId: string,
    provider: string,
    token: string,
    refreshToken = '',
    expiresIn?: number,
    username?: string,
    isBetweenSteps = false,
    refresh?: string,
    timezone?: number,
    customInstanceDetails?: string,
    binding?: ConnectLinkBinding
  ) {
    const uploadedPicture = await this.storeProfilePicture(org, picture).catch(
      (err) => {
        console.log('Failed to upload profile picture:', err);
        return undefined;
      }
    );

    const migration =
      binding && !binding.rootInternalId
        ? await this.findMigrationOnConnect(org, provider, {
            id: internalId,
            username: username || '',
          })
        : undefined;
    return this._integrationRepository.createOrUpdateIntegration(
      additionalSettings,
      oneTimeToken,
      org,
      name,
      uploadedPicture,
      type,
      internalId,
      provider,
      token,
      refreshToken,
      expiresIn,
      username,
      isBetweenSteps,
      refresh,
      timezone,
      customInstanceDetails,
      migration
        ? {
            ...binding,
            migration: {
              id: migration.id,
              internalId: migration.internalId,
              providerIdentifier: migration.providerIdentifier,
            },
          }
        : binding
    );
  }

  updateIntegrationGroup(org: string, id: string, group: string) {
    return this._integrationRepository.updateIntegrationGroup(org, id, group);
  }

  updateOnCustomerName(org: string, id: string, name: string) {
    return this._integrationRepository.updateOnCustomerName(org, id, name);
  }

  getIntegrationsList(org: string, discoverBrowser = false) {
    return this._integrationRepository.getIntegrationsList(
      org,
      discoverBrowser
    );
  }

  getChannelHealth(org: string, includeDeleted = false) {
    return this._integrationRepository.getChannelHealth(org, includeDeleted);
  }

  getIntegrationForOrder(id: string, order: string, user: string, org: string) {
    return this._integrationRepository.getIntegrationForOrder(
      id,
      order,
      user,
      org
    );
  }

  updateCustomName(org: string, id: string, name: string) {
    return this._integrationRepository.updateCustomName(org, id, name);
  }

  updateNameAndUrl(id: string, name: string, url: string) {
    return this._integrationRepository.updateNameAndUrl(id, name, url);
  }

  getIntegrationById(org: string, id: string) {
    return this._integrationRepository.getIntegrationById(org, id);
  }

  getIntegrationByInternalId(org: string, internalId: string) {
    return this._integrationRepository.getIntegrationByInternalId(
      org,
      internalId
    );
  }

  async refreshToken(provider: SocialProvider, refresh: string) {
    try {
      const { refreshToken, accessToken, expiresIn } =
        await provider.refreshToken(refresh);

      if (!refreshToken || !accessToken || !expiresIn) {
        return false;
      }

      return { refreshToken, accessToken, expiresIn };
    } catch (e) {
      return false;
    }
  }

  async disconnectChannel(orgId: string, integration: Integration, err = '') {
    await this._integrationRepository.disconnectChannel(orgId, integration.id);
    await this.informAboutRefreshError(orgId, integration, err);
  }

  // A reconnect that came back from a different provider (MIGRATE_PROVIDERS):
  // match the disconnected channel by profile and move it to the new provider
  // in place, so scheduled posts, settings and customers survive. Throws the
  // same error as a mismatched reconnect when the migration is not configured
  // or the user connected a different account.
  async migrateIntegration(
    org: string,
    oldInternalId: string,
    newProvider: string,
    auth: { id: string; username: string }
  ) {
    const existing = await this._integrationRepository.getIntegrationByInternalId(
      org,
      oldInternalId
    );

    if (
      !existing ||
      this._integrationManager.getMigrationTarget(
        existing.providerIdentifier
      ) !== newProvider
    ) {
      throw new NotEnoughScopes(
        'Please refresh the channel that needs to be refreshed'
      );
    }

    const oldProvider = this._integrationManager.getSocialIntegration(
      existing.providerIdentifier
    );

    if (!oldProvider.migrationMatch(auth, existing)) {
      throw new NotEnoughScopes(
        `Please connect the same account (@${existing.profile}) that needs to be refreshed`
      );
    }

    if (
      await this._integrationRepository.getIntegrationByInternalId(org, auth.id)
    ) {
      throw new NotEnoughScopes(
        'This account is already connected as another channel, please delete one of them first'
      );
    }

    return this._integrationRepository.migrateIntegration(
      org,
      existing.id,
      auth.id,
      newProvider,
      existing.rootInternalId === existing.internalId
        ? auth.id
        : existing.rootInternalId
    );
  }

  // A fresh connect of a migration target (MIGRATE_PROVIDERS) for an account
  // the org already has on the source provider: adopt that channel instead of
  // creating a confusing duplicate - the channel is migrated in place exactly
  // like a reconnect, and the follow-up upsert stores the fresh tokens. A no-op
  // when nothing matches, so a genuinely new account still creates a channel.
  async migrateIntegrationOnConnect(
    org: string,
    newProvider: string,
    auth: { id: string; username: string }
  ) {
    const existing = await this.findMigrationOnConnect(org, newProvider, auth);
    if (!existing) {
      return;
    }

    return this._integrationRepository.migrateIntegration(
      org,
      existing.id,
      auth.id,
      newProvider,
      existing.rootInternalId === existing.internalId
        ? auth.id
        : existing.rootInternalId
    );
  }

  private async findMigrationOnConnect(
    org: string,
    newProvider: string,
    auth: { id: string; username: string }
  ) {
    const sources = this._integrationManager.getMigrationSources(newProvider);
    if (
      !sources.length ||
      this._integrationManager.getSocialIntegration(newProvider).isBetweenSteps
    ) {
      return;
    }

    // the account already exists on the new provider: the normal upsert
    // updates it, nothing to adopt
    if (
      await this._integrationRepository.getIntegrationByInternalId(org, auth.id)
    ) {
      return;
    }

    return (await this._integrationRepository.getIntegrationsList(org)).find(
      (p) =>
        sources.includes(p.providerIdentifier) &&
        this._integrationManager
          .getSocialIntegration(p.providerIdentifier)
          .migrationMatch(auth, p)
    );
  }

  async informAboutRefreshError(
    orgId: string,
    integration: Integration,
    err = ''
  ) {
    await this._notificationService.inAppNotification(
      orgId,
      `Could not refresh your ${integration.providerIdentifier} channel`,
      `Could not refresh your ${integration.providerIdentifier} channel ${err}. Please go back to the system and connect it again ${process.env.FRONTEND_URL}/launches`,
      true,
      false,
      'info'
    );
  }

  async refreshNeeded(org: string, id: string) {
    return this._integrationRepository.refreshNeeded(org, id);
  }

  async setBetweenRefreshSteps(id: string) {
    return this._integrationRepository.setBetweenRefreshSteps(id);
  }

  async refreshTokens() {
    const integrations = await this._integrationRepository.needsToBeRefreshed();
    for (const integration of integrations) {
      const provider = this._integrationManager.getSocialIntegration(
        integration.providerIdentifier
      );

      const data = await this.refreshToken(provider, integration.refreshToken!);

      if (!data) {
        // A per-channel refresh may have rotated this row between the batch
        // snapshot and our own provider call. The provider then rejects the
        // old refresh token even though the channel is healthy; reuse the
        // winner instead of flagging a channel the merchant just fixed.
        if (await this.reuseParallelRefresh(integration)) {
          continue;
        }

        const flagged = await this._integrationRepository.refreshNeeded(
          integration.organizationId,
          integration.id
        );
        // One revoked channel must not stop the batch: the remaining rows are
        // unrelated accounts (and providers) that still need their rotate.
        // Notify only when this refresh is what flagged the channel, so a
        // provider that stays broken doesn't email on every pass.
        if (flagged) {
          await this.informAboutRefreshError(
            integration.organizationId,
            integration
          );
        }
        continue;
      }

      const { refreshToken, accessToken, expiresIn } = data;

      await this.createOrUpdateIntegration(
        undefined,
        !!provider.oneTimeToken,
        integration.organizationId,
        integration.name,
        undefined,
        'social',
        integration.internalId,
        integration.providerIdentifier,
        accessToken,
        refreshToken,
        expiresIn
      );
    }
  }

  // Same reuse rule as the per-channel refresh: wait briefly for the parallel
  // writer, then accept only a rotated, unexpired credential of the same
  // channel. A broken channel never becomes "fresh" by reading it again.
  // The batch retries faster (250/500 ms) because it must not stall a whole
  // pass; the per-channel path waits 1/2 s inside its own workflow.
  private async reuseParallelRefresh(integration: Integration) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const stored = await this._integrationRepository.getIntegrationById(
        integration.organizationId,
        integration.id
      );

      if (isReusableRefreshCredential(stored, integration)) {
        return true;
      }

      if (attempt < 2) {
        await timer(250 * (attempt + 1));
      }
    }

    return false;
  }

  async disableChannel(org: string, id: string) {
    return this._integrationRepository.disableChannel(org, id);
  }

  async enableChannel(org: string, totalChannels: number, id: string) {
    const integrations = (
      await this._integrationRepository.getIntegrationsList(org)
    ).filter((f) => !f.disabled);
    if (
      !!process.env.STRIPE_PUBLISHABLE_KEY &&
      integrations.length >= totalChannels
    ) {
      throw new Error('You have reached the maximum number of channels');
    }

    return this._integrationRepository.enableChannel(org, id);
  }

  async getPostsForChannel(org: string, id: string) {
    return this._integrationRepository.getPostsForChannel(org, id);
  }

  async deleteChannel(org: string, id: string) {
    return this._integrationRepository.deleteChannel(org, id);
  }

  async disableIntegrations(org: string, totalChannels: number) {
    return this._integrationRepository.disableIntegrations(org, totalChannels);
  }

  async enableAllIntegrations(org: string) {
    return this._integrationRepository.enableAllIntegrations(org);
  }

  async checkForDeletedOnceAndUpdate(org: string, page: string) {
    return this._integrationRepository.checkForDeletedOnceAndUpdate(org, page);
  }

  async saveProviderPage(org: string, id: string, data: any) {
    const getIntegration = await this._integrationRepository.getIntegrationById(
      org,
      id
    );
    if (!getIntegration) {
      throw new HttpException('Integration not found', HttpStatus.NOT_FOUND);
    }
    if (!getIntegration.inBetweenSteps) {
      throw new HttpException('Invalid request', HttpStatus.BAD_REQUEST);
    }

    const provider = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    if (!provider.fetchPageInformation) {
      throw new HttpException(
        'Provider does not support page selection',
        HttpStatus.BAD_REQUEST
      );
    }

    const getIntegrationInformation = await provider.fetchPageInformation(
      getIntegration.token,
      data
    );

    await this.checkForDeletedOnceAndUpdate(
      org,
      String(getIntegrationInformation.id)
    );
    await this._integrationRepository.updateIntegration(id, {
      picture: await this.storeProfilePicture(
        org,
        getIntegrationInformation.picture,
        getIntegration.picture
      ),
      internalId: String(getIntegrationInformation.id),
      organizationId: org,
      name: getIntegrationInformation.name,
      inBetweenSteps: false,
      token: getIntegrationInformation.access_token,
      profile: getIntegrationInformation.username,
    });

    return { success: true };
  }

  // Connect links (public API): the link opens a Postiz page that explains what
  // connecting the channel means, and only from there the person is sent to
  // the platform. Like the invite links of the dashboard, only providers that
  // connect with a plain redirect can be linked.
  async createConnectLink(
    org: string,
    integration: string,
    redirectUrl?: string
  ) {
    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration) ||
      this._integrationManager.isHiddenProvider(integration)
    ) {
      throw new HttpException(
        'Integration not allowed',
        HttpStatus.BAD_REQUEST
      );
    }

    if (
      !this._integrationManager
        .getLinkableSocialsIntegrations()
        .includes(integration)
    ) {
      throw new HttpException(
        'This integration cannot be connected with a link',
        HttpStatus.BAD_REQUEST
      );
    }

    const token = randomBytes(32).toString('hex');
    await this.connectLinks.storeLink(token, {
      org,
      integration,
      redirectUrl,
      redirectTo: redirectUrl
        ? this.connectLinkRedirectHost(redirectUrl)
        : undefined,
    });

    return { url: `${process.env.FRONTEND_URL}/integrations/connect/${token}` };
  }

  // The browser is sent to this URL with the result added to its query string,
  // and the page shows its host: it has to be http(s), parse the way a browser
  // reads it and carry no fragment
  private connectLinkRedirectHost(redirectUrl: string) {
    try {
      const { protocol, host } = new URL(redirectUrl);
      if (
        ['http:', 'https:'].includes(protocol) &&
        !redirectUrl.includes('#')
      ) {
        return host;
      }
    } catch (err) {}

    throw new HttpException(
      'The redirect URL must be an http(s) URL without a fragment',
      HttpStatus.BAD_REQUEST
    );
  }

  claimConnectAuthorization(state: string, provider: string) {
    return this.connectLinks.claimAuthorization(state, provider);
  }

  rememberDashboardSelection(state: string, id: string, org: string) {
    return this.connectLinks.storeSelection(state, id, org);
  }

  async completeDashboardSelection(state: string, id: string, body: unknown) {
    const organization = await this.connectLinks.readSelection(state, id);
    await this.connectLinks.consumeSelection(state, id);
    try {
      return await this.saveProviderPage(organization, id, body);
    } catch (err) {
      await this.connectLinks.storeSelection(state, id, organization);
      throw err;
    }
  }

  // The organization the channel is added to, the controller checks its plan
  async getConnectLinkOrganization(token: string) {
    return (await this.connectLinks.loadLink(token)).org;
  }

  // What the page shows: the platform, and where the person ends up afterwards
  async getConnectLink(token: string) {
    const { integration, redirectTo } = await this.connectLinks.loadLink(token);
    const provider = this._integrationManager.getSocialIntegration(integration);
    return {
      identifier: provider.identifier,
      name: provider.name,
      ...(redirectTo ? { redirectTo } : {}),
    };
  }

  // The person agreed: from here it is the same flow as connecting from the
  // dashboard, the platform sends them back to /integrations/social/:provider.
  // The link stays valid until it expires, so they can come back and try again
  async startConnectLink(token: string) {
    const { integration } = await this.connectLinks.loadLink(token);
    const provider = this._integrationManager.getSocialIntegration(integration);

    try {
      const { codeVerifier, state, url } = await provider.generateAuthUrl();

      await this.connectLinks.startAuthorization(state, token, codeVerifier);

      return { url };
    } catch (err) {
      throw new HttpException(
        'Failed to generate auth URL',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async listConnectPages(provider: SocialProvider, accessToken: string) {
    const load =
      'pages' in provider
        ? provider.pages
        : 'companies' in provider
        ? provider.companies
        : undefined;
    if (typeof load !== 'function')
      throw new HttpException('Page selection is unavailable', 400);
    const listed: ConnectPage[] = await load.call(provider, accessToken);
    return listed.map(
      ({
        id,
        name,
        username,
        pageId,
        locationName,
        accountName,
        picture,
        address,
        subscriberCount,
      }) => ({
        id,
        name,
        username,
        pageId,
        locationName,
        accountName,
        picture,
        address,
        subscriberCount,
      })
    );
  }

  async stageConnectLinkPages(
    token: string,
    state: string,
    provider: SocialProvider,
    auth: AuthTokenDetails,
    timezone: number
  ) {
    const pages = await this.listConnectPages(provider, auth.accessToken);
    if (!pages.length)
      throw new HttpException(
        'No manageable pages were returned by the provider',
        400
      );
    const id = 'selection-' + randomBytes(24).toString('hex');
    const selection: PendingConnectSelection = {
      token,
      auth,
      pages,
      timezone,
      authorizedAt: Date.now(),
    };
    const value = await this._encryptionService.encrypt(
      JSON.stringify(selection)
    );
    await this.connectLinks.storeSelection(state, id, value);
    return { id, inBetweenSteps: true, publicSelection: true, pages };
  }

  async completeConnectLinkPage(
    state: string,
    id: string,
    selectedId: string,
    getLimit: (org: string) => Promise<number | undefined>
  ) {
    const value = await this.connectLinks.readSelection(state, id);
    const pending: PendingConnectSelection = JSON.parse(
      await this._encryptionService.decrypt(value)
    );
    const link = await this.connectLinks.loadLink(pending.token);
    const provider = this._integrationManager.getSocialIntegration(
      link.integration
    );
    const page = pending.pages.find((item) => String(item.id) === selectedId);
    if (!page || !provider.fetchPageInformation)
      throw new HttpException('Select an available page', 400);

    // Only pass the page metadata originally returned by this provider.
    const info = await provider.fetchPageInformation(pending.auth.accessToken, {
      ...page,
      page: page.id,
    });
    if (!info.id || !info.access_token)
      throw new HttpException('Could not confirm this page', 400);
    const channelLimit = await getLimit(link.org);
    await this.connectLinks.consumeSelection(state, id);
    const { auth, authorizedAt, timezone } = pending;
    try {
      const bound = await this.createOrUpdateIntegration(
        auth.additionalSettings,
        !!provider.oneTimeToken,
        link.org,
        info.name,
        info.picture,
        'social',
        String(info.id),
        link.integration,
        info.access_token,
        auth.refreshToken,
        auth.expiresIn
          ? Math.max(
              1,
              auth.expiresIn - Math.floor((Date.now() - authorizedAt) / 1000)
            )
          : undefined,
        info.username,
        false,
        undefined,
        timezone,
        undefined,
        { rootInternalId: String(auth.id), channelLimit }
      );
      this._refreshIntegrationService
        .startRefreshWorkflow(link.org, bound.id, provider)
        .catch(console.error);
    } catch (err) {
      // The original consent link still bounds the lifetime of a retry.
      await this.connectLinks.storeSelection(state, id, value);
      throw err;
    }
    return { success: true };
  }

  async checkAnalytics(
    org: Organization,
    integration: string,
    date: string,
    forceRefresh = false
  ): Promise<AnalyticsData[]> {
    // Days to load, missing or invalid on some public API calls (same default as the app)
    const days = Number(date) > 0 ? Number(date) : 7;
    const getIntegration = await this.getIntegrationById(org.id, integration);

    if (!getIntegration) {
      throw new Error('Invalid integration');
    }

    if (getIntegration.type !== 'social') {
      return [];
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this.disconnectChannel(org.id, getIntegration);
        return [];
      }
    }

    const getIntegrationData = await ioRedis.get(
      `integration:${org.id}:${integration}:${days}`
    );
    if (getIntegrationData) {
      return JSON.parse(getIntegrationData);
    }

    if (integrationProvider.analytics) {
      try {
        const loadAnalytics = await integrationProvider.analytics(
          getIntegration.internalId,
          getIntegration.token,
          days
        );
        await ioRedis.set(
          `integration:${org.id}:${integration}:${days}`,
          JSON.stringify(loadAnalytics),
          'EX',
          !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
            ? 1
            : 3600
        );
        return loadAnalytics;
      } catch (e) {
        if (e instanceof RefreshToken) {
          return this.checkAnalytics(org, integration, date, true);
        }
      }
    }

    return [];
  }

  customers(orgId: string) {
    return this._integrationRepository.customers(orgId);
  }

  async updateCustomerName(orgId: string, id: string, name: string) {
    const exists = await this._integrationRepository.getCustomerByName(
      orgId,
      name
    );
    if (exists && exists.id !== id) {
      throw new HttpException(
        'A group with this name already exists',
        HttpStatus.BAD_REQUEST
      );
    }
    return this._integrationRepository.updateCustomerName(orgId, id, name);
  }

  getPlugsByIntegrationId(org: string, integrationId: string) {
    return this._integrationRepository.getPlugsByIntegrationId(
      org,
      integrationId
    );
  }

  async processInternalPlug(
    data: {
      post: string;
      originalIntegration: string;
      integration: string;
      plugName: string;
      orgId: string;
      delay: number;
      information: any;
    },
    forceRefresh = false
  ): Promise<any> {
    const originalIntegration =
      await this._integrationRepository.getIntegrationById(
        data.orgId,
        data.originalIntegration
      );

    const getIntegration = await this._integrationRepository.getIntegrationById(
      data.orgId,
      data.integration
    );

    if (!getIntegration || !originalIntegration) {
      return;
    }

    const getAllInternalPlugs = this._integrationManager
      .getInternalPlugs(getIntegration.providerIdentifier)
      .internalPlugs.find((p: any) => p.identifier === data.plugName);

    if (!getAllInternalPlugs) {
      return;
    }

    const getSocialIntegration = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    // @ts-ignore
    await getSocialIntegration?.[getAllInternalPlugs.methodName]?.(
      getIntegration,
      originalIntegration,
      data.post,
      data.information
    );

    return;
  }

  async processPlugs(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    const getPlugById = await this._integrationRepository.getPlug(data.plugId);
    if (!getPlugById) {
      return true;
    }

    const integration = this._integrationManager.getSocialIntegration(
      getPlugById.integration.providerIdentifier
    );

    // @ts-ignore
    const process = await integration[getPlugById.plugFunction](
      getPlugById.integration,
      data.postId,
      JSON.parse(getPlugById.data).reduce((all: any, current: any) => {
        all[current.name] = current.value;
        return all;
      }, {})
    );

    if (process) {
      return true;
    }

    if (data.totalRuns === data.currentRun) {
      return true;
    }

    return false;
  }

  async createOrUpdatePlug(
    orgId: string,
    integrationId: string,
    body: PlugDto
  ) {
    const { activated } = await this._integrationRepository.createOrUpdatePlug(
      orgId,
      integrationId,
      body
    );

    return {
      activated,
    };
  }

  async changePlugActivation(orgId: string, plugId: string, status: boolean) {
    const { id, integrationId, plugFunction } =
      await this._integrationRepository.changePlugActivation(
        orgId,
        plugId,
        status
      );

    return { id };
  }

  async getPlugs(orgId: string, integrationId: string) {
    return this._integrationRepository.getPlugs(orgId, integrationId);
  }

  async loadExisingData(
    methodName: string,
    integrationId: string,
    id: string[]
  ) {
    const exisingData = await this._integrationRepository.loadExisingData(
      methodName,
      integrationId,
      id
    );
    const loadOnlyIds = exisingData.map((p) => p.value);
    return difference(id, loadOnlyIds);
  }

  // The tokens of a channel that came from a workflow. A workflow carries the
  // channel from one activity to the next, so an activity can get its tokens
  // encrypted (an activity handed them out that way) or plain (the workflow
  // started before the tokens were encrypted, or the install has no
  // encryption), and even one of each. Every activity that uses a token of a
  // channel it got from a workflow goes through here first; a plain token is
  // used as it is.
  async decryptTokens<T extends Partial<Integration>>(integration: T) {
    return integration
      ? this._encryptionService.decryptFields(
          integration,
          integrationEncryptedFields
        )
      : integration;
  }

  // One page of the encryptTokensWorkflow: encrypts the tokens that are still
  // stored plain. New tokens are already stored encrypted, this is for the
  // ones that were stored before the encryption.
  async encryptStoredTokens(afterId?: string) {
    if (!this._encryptionService.canEncrypt()) {
      // a configuration that has to change first, no retry will fix it
      throw ApplicationFailure.nonRetryable(
        'The encryption is off, set ENCRYPTION_PROVIDER and remove ENCRYPTION_READ_ONLY'
      );
    }

    const integrations = await this._integrationRepository.getPlainTokens(
      afterId
    );

    // A channel that cannot be encrypted is counted and skipped, it must not
    // stop all the channels after it
    let changed = 0;
    let failed = 0;
    for (const integration of integrations) {
      try {
        if (
          await this._integrationRepository.encryptStoredTokens(integration)
        ) {
          changed++;
        }
      } catch (err) {
        failed++;
        console.error(
          `Could not encrypt the stored tokens of integration ${integration.id}:`,
          (err as Error)?.message
        );
      }
    }

    return {
      changed,
      failed,
      lastId: integrations[integrations.length - 1]?.id,
    };
  }

  async findFreeDateTime(
    orgId: string,
    integrationsId?: string
  ): Promise<number[]> {
    const findTimes = await this._integrationRepository.getPostingTimes(
      orgId,
      integrationsId
    );
    return uniq(
      findTimes.reduce((all: any, current: any) => {
        return [
          ...all,
          ...JSON.parse(current.postingTimes).map(
            (p: { time: number }) => p.time
          ),
        ];
      }, [] as number[])
    );
  }
}
