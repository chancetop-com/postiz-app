import { applyDecorators, createParamDecorator, ExecutionContext, ForbiddenException, SetMetadata } from '@nestjs/common';
import { AuthorizationActions, Sections } from './permission.exception.class';

export const CHECK_POLICIES_KEY = 'check_policy';
export type AbilityPolicy = [AuthorizationActions, Sections];
export const CheckPolicies = (...handlers: AbilityPolicy[]) =>
  SetMetadata(CHECK_POLICIES_KEY, handlers);

// An existing-post date/status change can enqueue a browser publication.
export const BROWSER_SCHEDULE_POLICY = 'browser_schedule_policy';
export const CheckBrowserSchedulePolicy = (operation: 'date' | 'status') => applyDecorators(
  SetMetadata(BROWSER_SCHEDULE_POLICY, operation),
  CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
);

export const BrowserScheduleCheck = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const check = context.switchToHttp().getRequest().assertBrowserScheduleAllowed;
    if (typeof check !== 'function') throw new ForbiddenException();
    return check;
  }
);
