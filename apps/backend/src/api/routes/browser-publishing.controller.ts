import type { BrowserReviewDecision } from '@gitroom/nestjs-libraries/database/prisma/browser-publishing/occurrence';
import { BrowserProfileInput } from '@gitroom/helpers/utils/browser-publishing';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Query,
  Param,
  Put,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { BrowserPublishingService } from '@gitroom/nestjs-libraries/database/prisma/browser-publishing/browser-publishing.service';

@Controller('/admin/browser-publishing/:organizationId')
export class BrowserPublishingController {
  constructor(private service: BrowserPublishingService) {}

  private requireOperator(user: User) {
    if (!user?.isSuperAdmin)
      throw new ForbiddenException('Platform operator required');
  }

  @Get('occurrences')
  incidents(
    @GetUserFromRequest() user: User,
    @Param('organizationId') org: string,
    @Query('cursor') cursor?: string
  ) {
    this.requireOperator(user);
    return this.service.incidents(org, cursor);
  }

  @Get('occurrences/:workflowId')
  evidence(
    @GetUserFromRequest() user: User,
    @Param('organizationId') org: string,
    @Param('workflowId') id: string
  ) {
    this.requireOperator(user);
    return this.service.evidence(org, id);
  }

  @Get('occurrences/:workflowId/review')
  open(
    @GetUserFromRequest() user: User,
    @Param('organizationId') org: string,
    @Param('workflowId') id: string
  ) {
    this.requireOperator(user);
    return this.service.review(org, id, user.id, true);
  }

  @Put('occurrences/:workflowId/review')
  decide(
    @GetUserFromRequest() user: User,
    @Param('organizationId') org: string,
    @Param('workflowId') id: string,
    @Body() decision: BrowserReviewDecision
  ) {
    this.requireOperator(user);
    return this.service.review(org, id, user.id, true, decision);
  }

  @Put()
  setEnabled(
    @GetUserFromRequest() user: User,
    @Param('organizationId') org: string,
    @Body() body: { merchantId: string; enabled: boolean }
  ) {
    this.requireOperator(user);
    return this.service.setEnabled(org, body);
  }

  @Put('bindings')
  bind(
    @GetUserFromRequest() user: User,
    @Param('organizationId') org: string,
    @Body() body: BrowserProfileInput
  ) {
    this.requireOperator(user);
    return this.service.bind(org, body);
  }

  @Delete('bindings/:bindingId')
  unbind(
    @GetUserFromRequest() user: User,
    @Param('organizationId') org: string,
    @Param('bindingId') bindingId: string
  ) {
    this.requireOperator(user);
    return this.service.unbind(org, bindingId);
  }
}
