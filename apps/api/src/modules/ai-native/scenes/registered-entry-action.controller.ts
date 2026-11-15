/** Fixed surface Action transport. Original request bodies stay closed;
 * issue and use only observe current original resources, never execute them. */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { AI_REGISTERED_ENTRY_ACTION_HTTP, aiRegisteredEntryActionObservationSchema,
  aiRegisteredEntryActionRevalidationSchema, aiRegisteredEntryActionOrderResponseSchema } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { respondAiScene } from './original-scenes.controller';
import { withRequestAbort } from './request-abort';
import type { RegisteredEntryActionFactory } from './registered-entry-action.application';

export const AI_OPERATOR_ENTRY_ACTIONS = Symbol('AI_OPERATOR_ENTRY_ACTIONS');
export const AI_STAFF_ENTRY_ACTIONS = Symbol('AI_STAFF_ENTRY_ACTIONS');
export const AI_WEBSITE_ENTRY_ACTIONS = Symbol('AI_WEBSITE_ENTRY_ACTIONS');
export const AI_WECHAT_ENTRY_ACTIONS = Symbol('AI_WECHAT_ENTRY_ACTIONS');
type Request = IncomingMessage & { body?: unknown; ip?: string };
@Controller(AI_REGISTERED_ENTRY_ACTION_HTTP.operatorBasePath)
export class OperatorRegisteredEntryActionController {
  constructor(@Inject(AI_OPERATOR_ENTRY_ACTIONS) private readonly create: RegisteredEntryActionFactory) {}
  private call(name: 'issue' | 'revalidate' | 'fromOrder', request: Request, value: unknown) {
    return respondAiScene(() => withRequestAbort(request, async signal => {
      const app = this.create(request), stop = () => app.close();
      signal.addEventListener('abort', stop, { once: true });
      try {
        const result = await app[name](structuredClone(request.body ?? value), signal);
        const schema = name === 'issue' ? aiRegisteredEntryActionObservationSchema
          : name === 'revalidate' ? aiRegisteredEntryActionRevalidationSchema : aiRegisteredEntryActionOrderResponseSchema;
        if (!schema.safeParse(result).success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return result;
      } finally { app.close(); signal.removeEventListener('abort', stop); }
    }, { maxWaitMs: 15000 }), 'read_original_resource');
  }
  @Post(AI_REGISTERED_ENTRY_ACTION_HTTP.issue) @HttpCode(200) @Header('Cache-Control', 'no-store')
  issue(@Req() request: Request, @Body() value: unknown) { return this.call('issue', request, value); }
  @Post(AI_REGISTERED_ENTRY_ACTION_HTTP.revalidate) @HttpCode(200) @Header('Cache-Control', 'no-store')
  revalidate(@Req() request: Request, @Body() value: unknown) { return this.call('revalidate', request, value); }
  @Post(AI_REGISTERED_ENTRY_ACTION_HTTP.fromOrder) @HttpCode(200) @Header('Cache-Control', 'no-store')
  fromOrder(@Req() request: Request, @Body() value: unknown) { return this.call('fromOrder', request, value); }
}
@Controller(AI_REGISTERED_ENTRY_ACTION_HTTP.staffBasePath)
export class StaffRegisteredEntryActionController extends OperatorRegisteredEntryActionController {
  constructor(@Inject(AI_STAFF_ENTRY_ACTIONS) create: RegisteredEntryActionFactory) { super(create); }
}
@Controller(AI_REGISTERED_ENTRY_ACTION_HTTP.websiteBasePath)
export class WebsiteRegisteredEntryActionController extends OperatorRegisteredEntryActionController {
  constructor(@Inject(AI_WEBSITE_ENTRY_ACTIONS) create: RegisteredEntryActionFactory) { super(create); }
}
@Controller(AI_REGISTERED_ENTRY_ACTION_HTTP.wechatBasePath)
export class WechatRegisteredEntryActionController extends OperatorRegisteredEntryActionController {
  constructor(@Inject(AI_WECHAT_ENTRY_ACTIONS) create: RegisteredEntryActionFactory) { super(create); }
}
