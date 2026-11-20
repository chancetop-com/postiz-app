import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { Response, Request } from 'express';

import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { ForgotReturnPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot-return.password.dto';
import { ForgotPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot.password.dto';
import { ResendActivationDto } from '@gitroom/nestjs-libraries/dtos/auth/resend-activation.dto';
import { SsoLoginDto } from '@gitroom/nestjs-libraries/dtos/auth/sso.login.dto';
import { ApiTags } from '@nestjs/swagger';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { Provider } from '@prisma/client';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import * as Sentry from '@sentry/nestjs';
import { FarcasterProvider } from '@gitroom/nestjs-libraries/integrations/social/farcaster.provider';
import { AttributionService } from '@gitroom/nestjs-libraries/services/attribution/attribution.service';
import { ORG_INVITE_HEADER } from '@gitroom/helpers/auth/org.invite';

@ApiTags('Auth')
@Controller('/auth')
export class AuthController {
  constructor(
    private _authService: AuthService,
    private _emailService: EmailService,
    private _attributionService: AttributionService
  ) {}

  /**
   * The signed invitation token can arrive in the tab-scoped `org-invite`
   * request header (sessionStorage) or in the historical httpOnly `org`
   * cookie. Both carry the same signed payload; the AuthService verifies the
   * signature, role and expiry before any org id is trusted.
   */
  private getOrgInvite(req: Request) {
    const header = req.headers?.[ORG_INVITE_HEADER];
    return this._authService.getOrgFromCookie(
      (Array.isArray(header) ? header[0] : header) || req?.cookies?.org
    );
  }

  @Get('/can-register')
  async canRegister() {
    return {
      register: await this._authService.canRegister(Provider.LOCAL as string),
    };
  }

  // URL parameters the app keeps until sign-up for the attribution tools
  @Get('/attribution')
  attribution() {
    return {
      params: this._attributionService.queryParams(),
    };
  }

  @Post('/register')
  async register(
    @Req() req: Request,
    @Body() body: CreateOrgUserDto,
    @Res({ passthrough: false }) response: Response,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    try {
      const getOrgFromCookie = this.getOrgInvite(req);

      const { jwt, addedOrg } = await this._authService.routeAuth(
        body.provider,
        body,
        ip,
        userAgent,
        getOrgFromCookie
      );

      const activationRequired =
        body.provider === 'LOCAL' && this._emailService.hasProvider();

      if (activationRequired) {
        response.header('activate', 'true');
        response.status(200).json({ activate: true });
        return;
      }

      response.header('auth', jwt);

      if (typeof addedOrg !== 'boolean' && addedOrg?.organizationId) {
        response.header('showorg', addedOrg.organizationId);
      }

      Sentry.metrics.count('new_user', 1);
      response.header('onboarding', 'true');
      response.status(200).json({
        register: true,
      });
    } catch (e: any) {
      response.status(400).send(e.message);
    }
  }

  @Post('/login')
  async login(
    @Req() req: Request,
    @Body() body: LoginUserDto,
    @Res({ passthrough: false }) response: Response,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    try {
      const getOrgFromCookie = this.getOrgInvite(req);

      const { jwt, addedOrg } = await this._authService.routeAuth(
        body.provider,
        body,
        ip,
        userAgent,
        getOrgFromCookie
      );

      response.header('auth', jwt);

      if (typeof addedOrg !== 'boolean' && addedOrg?.organizationId) {
        response.header('showorg', addedOrg.organizationId);
      }

      response.header('reload', 'true');
      response.status(200).json({
        login: true,
      });
    } catch (e: any) {
      response.status(400).send(e.message);
    }
  }

  @Post('/forgot')
  async forgot(@Body() body: ForgotPasswordDto) {
    try {
      await this._authService.forgot(body.email);
      return {
        forgot: true,
      };
    } catch (e) {
      return {
        forgot: false,
      };
    }
  }

  @Post('/forgot-return')
  async forgotReturn(@Body() body: ForgotReturnPasswordDto) {
    const reset = await this._authService.forgotReturn(body);
    return {
      reset: !!reset,
    };
  }

  @Get('/oauth-mobile-callback')
  mobileCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const scheme = process.env.MOBILE_APP_SCHEME || 'postiz://auth/callback';
    const params = new URLSearchParams();
    if (code) params.set('code', code);
    if (state) params.set('state', state);
    return response.redirect(302, `${scheme}?${params.toString()}`);
  }

  @Get('/oauth/:provider')
  async oauthLink(
    @Param('provider') provider: string,
    @Query() query: any,
    @Res({ passthrough: true }) response: Response
  ) {
    const state = `login-${makeSecureId(16)}`;
    response.header('oauth-state', state);
    response.header(
      'oauth-state-token',
      this._authService.createOAuthStateToken(provider, state)
    );
    response.header('Cache-Control', 'no-store');

    return this._authService.oauthLink(provider, { ...query, state });
  }

  @Post('/activate')
  async activate(
    @Req() req: Request,
    @Body('code') code: string,
    @Body('datafast_visitor_id') datafast_visitor_id: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const activate = await this._authService.activate(
      code,
      datafast_visitor_id,
      this.getOrgInvite(req)
    );
    if (!activate) {
      return response.status(200).json({ can: false });
    }

    response.header('auth', activate.jwt);
    if (
      typeof activate.addedOrg !== 'boolean' &&
      activate.addedOrg?.organizationId
    ) {
      response.header('showorg', activate.addedOrg.organizationId);
    }
    response.header('onboarding', 'true');

    return response.status(200).json({ can: true });
  }

  @Post('/resend-activation')
  async resendActivation(@Body() body: ResendActivationDto) {
    try {
      await this._authService.resendActivationEmail(body.email);
      return {
        success: true,
      };
    } catch (e: any) {
      return {
        success: false,
        message: e.message,
      };
    }
  }

  // public and creates a signer at Neynar per call, so cap it per client
  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 30, ttl: 3600000 } })
  @Post('/farcaster/signer')
  async farcasterSigner() {
    try {
      return await new FarcasterProvider().createSigner();
    } catch (err: any) {
      return { error: err.message || 'Failed to create signer' };
    }
  }

  // the modal polls every 2s for up to 10 minutes, so leave room for that
  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 1000, ttl: 3600000 } })
  @Get('/farcaster/signer')
  async farcasterSignerStatus(@Query('signerUuid') signerUuid: string) {
    try {
      return await new FarcasterProvider().signerStatus(signerUuid);
    } catch (err: any) {
      return { error: err.message || 'Failed to check signer' };
    }
  }

  @Post('/oauth/:provider/redirect')
  oauthRedirect(
    @Param('provider') provider: string,
    @Body('code') code: string,
    @Body('state') state: string,
    @Res({ passthrough: false }) response: Response
  ) {
    if (!code) {
      return response.redirect(303, `${process.env.FRONTEND_URL}/auth/login`);
    }

    const params = new URLSearchParams();
    params.set('code', code);
    if (state) params.set('state', state);
    params.set('provider', provider.toUpperCase());
    return response.redirect(
      303,
      `${process.env.FRONTEND_URL}/auth?${params.toString()}`
    );
  }

  @Post('/oauth/:provider/exists')
  async oauthExists(
    @Req() req: Request,
    @Body('code') code: string,
    @Body('redirect_uri') redirect_uri: string,
    @Body('state') state: string,
    @Param('provider') provider: string,
    @Res({ passthrough: false }) response: Response
  ) {
    // a cross-site form post can spoof any body field, a json body cannot
    if (!req.headers['content-type']?.includes('application/json')) {
      return response.status(400).send('Invalid request');
    }

    // Existing-user OAuth login: this path doesn't run routeAuth, so read the
    // signed invite (tab header or historical cookie) and join the org here
    // too (when the invite is valid). See register/login for the same logic.
    const getOrgFromCookie = this.getOrgInvite(req);

    const { jwt, token, addedOrg } = await this._authService.checkExists(
      provider,
      code,
      redirect_uri,
      state,
      req.get('oauth-state-token'),
      getOrgFromCookie
    );

    if (token) {
      return response.json({ token });
    }

    response.header('auth', jwt);

    // Joined a new org via the invite: tell the frontend to switch the active
    // org to it (mirrors register/login).
    if (typeof addedOrg !== 'boolean' && addedOrg?.organizationId) {
      response.header('showorg', addedOrg.organizationId);
    }

    response.header('reload', 'true');

    response.status(200).json({
      login: true,
    });
  }

  @Post('/sso')
  async ssoLogin(
    @Body() body: SsoLoginDto,
    @Res({ passthrough: false }) response: Response
  ) {
    try {
      const result = await this._authService.ssoLogin(body.auth_code);
      const jwt = await this._authService.signJwt(result.user);

      response.header('auth', jwt);
      if (result.orgId) {
        response.header('showorg', result.orgId);
      }
      response.status(200).json({ login: true });
    } catch (e: any) {
      response.status(400).send(e.message);
    }
  }
}
