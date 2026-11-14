/** Request-bound platform category proposal entry. Uses current original
 * platform Guards and the standard persisted model host. Only explicit generate
 * starts work; all other observations remain read-only and unknown stays original. */
import { Body, Controller, Header, HttpCode, HttpException, Inject, Param, Post, Req } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { PrismaClient } from '@prisma/client';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { randomUUID } from 'node:crypto';
import { AI_CATEGORY_PROPOSAL_HTTP, AI_CATEGORY_PROPOSAL_CONTRACTS, AI_CATEGORY_PROPOSAL_SCHEMAS, AI_CATEGORY_DRAFT_HTTP_SCHEMAS,
  type SystemUserRow } from '@rental-os/shared';
import { getRequestIdentity, runWithRequestIdentity } from '../../../common/request-identity';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { SecretBox } from '../../../common/secret-box';
import type { CategoryGovernanceController } from '../../rental-core/category-governance.controller';
import { CategoryGovernancePreviewGuard } from '../../rental-core/category-governance-preview.guard';
import type { GatewayCapacityPort } from '../gateway-capacity.ports';
import type { ModelJsonTransport } from '../chat-completions.adapter';
import type { AiRequestAbortSource } from '../scenes/request-abort';
import { withRequestAbort } from '../scenes/request-abort';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { CategoryDraftApplication, CategoryAssistError } from './category-draft.application';
import { CategoryProposalApplication } from './category-proposal.application';
import { composeCategoryModelHost } from './category-model-host.composition';

export const AI_CATEGORY_PROPOSAL_REQUESTS = Symbol('AI_CATEGORY_PROPOSAL_REQUESTS');
export const AI_NATIVE_CATEGORY_PROPOSAL_CONFIGURATION = Symbol('AI_NATIVE_CATEGORY_PROPOSAL_CONFIGURATION');
type Request = { headers: { authorization?: unknown }; body?: unknown } & AiRequestAbortSource;
type Operation = keyof typeof AI_CATEGORY_PROPOSAL_CONTRACTS;
const ajv = new Ajv({ strict: true, coerceTypes: false, removeAdditional: false, useDefaults: false }); addFormats(ajv);
for (const [name, schema] of Object.entries({ ...AI_CATEGORY_DRAFT_HTTP_SCHEMAS, ...AI_CATEGORY_PROPOSAL_SCHEMAS }))
  ajv.addSchema(schema, `#/components/schemas/${name}`);
const validate = (name: string, value: unknown) => ajv.getSchema(`#/components/schemas/${name}`)?.(value) === true;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED'), unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
export function composeCategoryProposalRequests(input: { db: PrismaClient; guard: Pick<ApiAuthGuard, 'canActivate'>; secrets: SecretBox;
  controller: CategoryGovernanceController; configuration(): unknown; capacity?: GatewayCapacityPort; protocol?: ModelJsonTransport;
  clock?: () => Date; monotonic?: () => number }) {
  return Object.freeze({ async consume(request: Request, operation: string, value: unknown, signal: AbortSignal) {
    if (!Object.hasOwn(AI_CATEGORY_PROPOSAL_CONTRACTS, operation)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const contract = AI_CATEGORY_PROPOSAL_CONTRACTS[operation as Operation], command = structuredClone(value);
    if (!validate(contract.request, command) || Buffer.byteLength(JSON.stringify(command), 'utf8') > 262144) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const header = request?.headers?.authorization;
    if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9._~+/-]+=*$/u.test(header) || header.length > 8192 || signal.aborted) throw denied();
    let open = true, entered = false;
    const close = () => { open = false; }; signal.addEventListener('abort', close, { once: true });
    const requestId = randomUUID(), credentials = { current: async () => {
      if (!open || signal.aborted) throw denied(); return { authorization: header, requestId, audience: 'operator' as const };
    } };
    let binding: string | undefined;
    const currentPlatform = async (purpose: 'read' | 'generate') => runWithRequestIdentity({}, async () => {
      await credentials.current();
      const path = purpose === 'generate' ? '/api/platform/rental-categories' : '/api/platform/rental-categories/capability-catalog';
      const req = { method: purpose === 'generate' ? 'POST' : 'GET', url: path, originalUrl: path,
        headers: { authorization: header }, query: {}, user: undefined as SystemUserRow | undefined };
      if (await input.guard.canActivate(new ExecutionContextHost([req])) !== true) throw denied();
      new CategoryGovernancePreviewGuard().canActivate();
      const identity = getRequestIdentity(), user = req.user;
      if (!user?.isSaasAdmin || !user.isActive || !identity?.isSaasAdmin || identity.staffApi || identity.userId !== user.id) throw denied();
      await credentials.current();
      const value = JSON.stringify({ identity, permissions: user.permissions, actorId: user.id, tenantId: user.tenantId });
      if (binding !== undefined && binding !== value) throw denied(); binding = value;
      return { tenantId: user.tenantId, actorId: user.id, audience: 'operator' as const, isSaasAdmin: true as const };
    });
    try {
      return await runWithRequestIdentity({}, async () => {
        await currentPlatform(contract.write ? 'generate' : 'read');
        const drafts = new CategoryDraftApplication({ guard: input.guard, credentials, controller: input.controller });
        let application!: CategoryProposalApplication;
        const host = operation === 'material' ? undefined : composeCategoryModelHost({ ...input, credentials, currentPlatform,
          readMaterial: (source, child) => application.readMaterial(source, child) });
        application = new CategoryProposalApplication({ sources: drafts, currentPlatform: () => currentPlatform('read'), model: host?.model });
        entered = contract.write;
        const result = operation === 'material' ? await application.readMaterial((command as { source: unknown }).source, signal)
          : operation === 'prepare' ? await application.prepare(command, signal)
            : operation === 'generate' ? await application.execute(command, signal)
              : operation === 'read' ? await application.readOriginal(command, signal)
                : operation === 'operation' ? await host!.observeOperation((command as { operationKey: string }).operationKey, signal)
                  : operation === 'policyRead' ? await host!.policy.read()
                    : operation === 'policyOperation' ? await host!.policy.operation(command) : await host!.policy.put(command);
        await currentPlatform(contract.write ? 'generate' : 'read');
        const wire = JSON.parse(JSON.stringify(result));
        if (Buffer.byteLength(JSON.stringify(wire), 'utf8') > 1048576 || !validate(contract.response, wire)) throw unavailable();
        return wire;
      });
    } catch (error) {
      if (entered && !(error instanceof CategoryAssistError && error.code === 'INVALID_INPUT'))
        throw Object.assign(new Error('AI_RESULT_UNKNOWN'), { code: 'AI_RESULT_UNKNOWN', retryable: false });
      throw error;
    } finally { close(); signal.removeEventListener('abort', close); }
  } });
}

@Controller(AI_CATEGORY_PROPOSAL_HTTP.basePath)
export class AiCategoryProposalController {
  constructor(@Inject(AI_CATEGORY_PROPOSAL_REQUESTS) private readonly requests: ReturnType<typeof composeCategoryProposalRequests>) {}
  @Post(':operation') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async consume(@Req() request: Request, @Param('operation') operation: string, @Body() body: unknown) {
    try { return await withRequestAbort(request, signal => {
      const selected = Object.entries(AI_CATEGORY_PROPOSAL_HTTP).find(([key, path]) => key in AI_CATEGORY_PROPOSAL_CONTRACTS && path === operation)?.[0];
      if (!selected) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      // Use the original body, before global DTO whitelist transformation.
      return this.requests.consume(request, selected, request.body ?? body, signal);
    }, { maxWaitMs: operation === AI_CATEGORY_PROPOSAL_HTTP.generate ? 120000 : 15000 }); }
    catch (error) {
      const raw = error instanceof Error && 'code' in error ? String(error.code) : '';
      const code = ['INVALID_INPUT', 'AI_INVALID_INPUT'].includes(raw) ? 'AI_INVALID_INPUT'
        : ['ACCESS_DENIED', 'AI_ACCESS_DENIED', 'FORBIDDEN'].includes(raw) ? 'AI_ACCESS_DENIED'
          : raw === 'AI_RESULT_UNKNOWN' ? raw : 'AI_RESOURCE_UNAVAILABLE';
      throw new HttpException({ code, retryable: false, ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction: 'read_original_operation' } : {}) },
        code === 'AI_INVALID_INPUT' ? 400 : code === 'AI_ACCESS_DENIED' ? 403 : code === 'AI_RESULT_UNKNOWN' ? 409 : 503);
    }
  }
}
