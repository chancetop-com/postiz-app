import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { BrowserPublishingService } from '@gitroom/nestjs-libraries/database/prisma/browser-publishing/browser-publishing.service';
import type { BrowserReviewDecision } from '@gitroom/nestjs-libraries/database/prisma/browser-publishing/occurrence';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

@Controller('/browser-publishing/review')
export class BrowserReviewController {
  constructor(private service: BrowserPublishingService) {}

  @Get(':workflowId')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  open(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('workflowId') id: string
  ) {
    return this.service.review(org.id, id, user.id, false);
  }

  @Put(':workflowId')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  decide(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('workflowId') id: string,
    @Body() decision: BrowserReviewDecision
  ) {
    return this.service.review(org.id, id, user.id, false, decision);
  }
}
