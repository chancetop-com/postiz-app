import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { BrowserPublishingService } from '@gitroom/nestjs-libraries/database/prisma/browser-publishing/browser-publishing.service';
import type { BrowserStartRef } from '@gitroom/nestjs-libraries/database/prisma/browser-publishing/occurrence';

@Controller('/internal/browser-publishing')
export class BrowserUploadController {
  constructor(private service: BrowserPublishingService) {}

  @Post('authorize-start')
  authorize(
    @Headers('authorization') authorization: string,
    @Body() ref: BrowserStartRef
  ) {
    const token = process.env.GATEWAY_INTERNAL_TOKEN;
    const supplied = Buffer.from(authorization || '');
    const required = Buffer.from('Bearer ' + token);
    if (
      !token?.trim() ||
      supplied.length !== required.length ||
      !timingSafeEqual(supplied, required)
    ) {
      throw new UnauthorizedException();
    }
    if (
      !ref ||
      ![ref.workflowId, ref.postId, ref.organizationId].every(
        (v) => typeof v === 'string' && v.length > 0
      )
    ) {
      throw new BadRequestException(
        'An occurrence, post and organization are required'
      );
    }
    if (
      ref.resultDeadlineAt !== undefined &&
      (typeof ref.resultDeadlineAt !== 'string' ||
        !Number.isFinite(Date.parse(ref.resultDeadlineAt)))
    ) {
      throw new BadRequestException('Invalid result deadline');
    }
    return this.service.authorizeStart(ref);
  }
}
