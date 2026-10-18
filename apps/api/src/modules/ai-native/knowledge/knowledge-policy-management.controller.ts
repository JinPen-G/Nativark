import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AI_KNOWLEDGE_POLICY_HTTP_DRAFT as paths, AI_KNOWLEDGE_POLICY_HTTP_ERRORS as errors } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { KNOWLEDGE_POLICY_MANAGEMENT, type KnowledgePolicyManagementApplication } from './knowledge-policy-management.composition';
import { KnowledgePolicyManagementError } from './knowledge-policy-management.validation';
import { withRequestAbort } from '../scenes/request-abort';
import type { IncomingMessage } from 'node:http';

export type KnowledgePolicyHttpRequest = { headers: { authorization?: unknown } } & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);

/** Transport only: the original application rechecks current Auth/Guard and persisted roots. */
@Controller(paths.basePath)
export class KnowledgePolicyManagementController {
  constructor(@Inject(KNOWLEDGE_POLICY_MANAGEMENT) private readonly application: KnowledgePolicyManagementApplication) {}

  private async call(method: keyof KnowledgePolicyManagementApplication, request: KnowledgePolicyHttpRequest, value: unknown) {
    try {
      const header = bearer.safeParse(request?.headers?.authorization);
      if (!header.success || typeof this.application?.[method] !== 'function') throw new KnowledgePolicyManagementError('unavailable');
      const credential = { authorization: header.data, audience: 'operator' as const, requestId: randomUUID() };
      const command = structuredClone(value);
      return await withRequestAbort<unknown>(request, signal => runWithRequestIdentity({}, async () => this.application[method](credential, command, signal)));
    } catch (error) {
      const key = error instanceof KnowledgePolicyManagementError ? error.code
        : error instanceof Error && 'code' in error && error.code === 'AI_RESULT_UNKNOWN'
          && ['prepareTarget', 'bindTarget', 'prepare', 'commit'].includes(method) ? 'result_unknown' : 'unavailable';
      const translated = errors[key];
      throw new HttpException({ code: translated.code, retryable: false,
        ...(key === 'result_unknown' ? { nextAction: 'read_original_policy_operation' } : {}) }, translated.status);
    }
  }

  @Post(paths.prepareTarget)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  prepareTarget(@Req() request: KnowledgePolicyHttpRequest, @Body() body: unknown) { return this.call('prepareTarget', request, body); }
  @Post(paths.target)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  target(@Req() request: KnowledgePolicyHttpRequest, @Body() body: unknown) { return this.call('target', request, body); }
  @Post(paths.bindTarget)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  bindTarget(@Req() request: KnowledgePolicyHttpRequest, @Body() body: unknown) { return this.call('bindTarget', request, body); }
  @Post(paths.read)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  read(@Req() request: KnowledgePolicyHttpRequest, @Body() body: unknown) { return this.call('read', request, body); }
  @Post(paths.prepare)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  prepare(@Req() request: KnowledgePolicyHttpRequest, @Body() body: unknown) { return this.call('prepare', request, body); }
  @Post(paths.preparation)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  preparation(@Req() request: KnowledgePolicyHttpRequest, @Body() body: unknown) { return this.call('preparation', request, body); }
  @Post(paths.commit)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  commit(@Req() request: KnowledgePolicyHttpRequest, @Body() body: unknown) { return this.call('commit', request, body); }
  @Post(paths.operation)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  operation(@Req() request: KnowledgePolicyHttpRequest, @Body() body: unknown) { return this.call('operation', request, body); }
}
