/** Fixed Web/WeChat public catalog/help host and explicit login continuation.
 * Public codes resolve existing channel records before a short ownership token
 * is issued. It never creates a customer session, Task, model call or booking.
 * Receipt reads retain original bindings independently of new publication. */
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  aiClientPublicReadRequestSchema, aiClientPublicSessionRequestSchema, aiClientPublicPreparationRequestSchema,
  aiClientPublicOperationRequestSchema, aiClientPublicContinuationRequestSchema,
  aiClientPublicContinuationReadRequestSchema, AI_CLIENT_PUBLIC_HTTP,
} from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { composeRequestBoundClientApplication, type AiClientRequestDependencies, type AiClientApplicationRequest } from './client-request.application';
import { ClientPublicContinuityService } from './client-public-continuity.service';
import { ClientPublicContinuityUnknownError } from './client-public-continuity.repository';
import { AiClientPublicSessionCredential } from './client-public-session.credential';

const config = z.object({ enabled: z.boolean() }).strict();
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const invalid = () => new AiTaskRepositoryError('AI_INVALID_INPUT');
type Selector = z.infer<typeof aiClientPublicSessionRequestSchema>;
export type AiClientPublicRequest = { headers: Record<string, unknown>; ip?: string };
export type AiClientPublicAction = 'read' | 'issueSession' | 'prepare' | 'readOriginal' | 'continueOriginal' | 'readContinuation';
export type AiClientPublicDependencies = {
  db: Pick<PrismaClient, '$transaction' | '$queryRaw' | '$executeRaw' | 'operationLog' | 'tenant' | 'businessWorkspace'
    | 'clientChannelProfile' | 'clientChannelWorkspace' | 'websiteChannelProfile'>;
  client: AiClientRequestDependencies['client']; guard: Pick<ApiAuthGuard, 'canActivate'>;
  ownership: AiClientPublicSessionCredential; currentConfiguration(): unknown; clock?: () => Date;
};

export class AiClientPublicApplication {
  private readonly clock: () => Date;
  constructor(private readonly dependencies: AiClientPublicDependencies, private readonly channel: 'web' | 'wechat_miniprogram') {
    if (!dependencies || typeof dependencies.currentConfiguration !== 'function'
      || typeof dependencies.ownership?.issue !== 'function' || typeof dependencies.ownership.verify !== 'function'
      || typeof dependencies.guard?.canActivate !== 'function' || !['web', 'wechat_miniprogram'].includes(channel)) throw unavailable();
    this.clock = dependencies.clock ?? (() => new Date());
  }
  private configuration() {
    const current = config.safeParse(structuredClone(this.dependencies.currentConfiguration() ?? { enabled: false }));
    if (!current.success) throw unavailable();
    return current.data;
  }
  private async target(selector: Selector, published: boolean) {
    const db = this.dependencies.db;
    const tenant = await db.tenant.findFirst({ where: { code: selector.tenantCode, status: 'ACTIVE' },
      select: { id: true, code: true, status: true } });
    if (!tenant || tenant.code !== selector.tenantCode || tenant.status !== 'ACTIVE') throw denied();
    const workspace = await db.businessWorkspace.findFirst({ where: { tenantId: tenant.id, code: selector.serviceCode, status: 'ACTIVE' },
      select: { id: true, tenantId: true, code: true, status: true } });
    if (!workspace || workspace.tenantId !== tenant.id || workspace.code !== selector.serviceCode || workspace.status !== 'ACTIVE') throw denied();
    const scope = { tenantId: tenant.id, workspaceId: workspace.id, channel: this.channel };
    if (!published) return { scope, fingerprint: hash({ tenant, workspace }) };
    const profile = await db.clientChannelProfile.findUnique({ where: { tenantId: tenant.id }, select: { id: true, tenantId: true, revision: true } });
    const publication = await db.clientChannelWorkspace.findFirst({ where: { tenantId: tenant.id, workspaceId: workspace.id, enabled: true },
      select: { id: true, tenantId: true, workspaceId: true, profileId: true, enabled: true } });
    const website = this.channel === 'web' ? await db.websiteChannelProfile.findUnique({ where: { tenantId: tenant.id },
      select: { tenantId: true, revision: true, enabled: true } }) : null;
    if (!profile || profile.tenantId !== tenant.id || !Number.isSafeInteger(profile.revision) || profile.revision < 1
      || !publication || publication.tenantId !== tenant.id || publication.workspaceId !== workspace.id
      || publication.profileId !== profile.id || !publication.enabled
      || this.channel === 'web' && (!website || website.tenantId !== tenant.id || !website.enabled
        || !Number.isSafeInteger(website.revision) || website.revision < 1)) throw unavailable();
    return { scope, fingerprint: hash({ tenant, workspace, profile, publication, website }) };
  }

  async call(request: AiClientPublicRequest, action: AiClientPublicAction, value: unknown, signal?: AbortSignal) {
    const schemas = { read: aiClientPublicReadRequestSchema, issueSession: aiClientPublicSessionRequestSchema,
      prepare: aiClientPublicPreparationRequestSchema, readOriginal: aiClientPublicOperationRequestSchema,
      continueOriginal: aiClientPublicContinuationRequestSchema, readContinuation: aiClientPublicContinuationReadRequestSchema };
    const parsed = schemas[action]?.safeParse(structuredClone(value));
    if (!parsed?.success) throw invalid();
    const command = parsed.data, selector = { tenantCode: command.tenantCode, serviceCode: command.serviceCode };
    const currentRequest: AiClientApplicationRequest = { headers: { authorization: request?.headers?.authorization }, ip: request?.ip };
    const credential = request?.headers?.[AI_CLIENT_PUBLIC_HTTP.credentialHeader];
    const observing = action === 'readOriginal' || action === 'readContinuation';
    // New publication is not a prerequisite for independently authorized
    // receipt reads. Same-key prepare/continue may also return an old receipt;
    // their new-work checks run only when the original service needs to write.
    const currentConfiguration = observing ? null : this.configuration();
    const before = await this.target(selector, false);
    const live = async () => {
      if (signal?.aborted) throw denied();
      const after = await this.target(selector, false);
      if (signal?.aborted || after.fingerprint !== before.fingerprint) throw denied();
    };
    let publication: Awaited<ReturnType<AiClientPublicApplication['target']>> | null = null;
    const newWork = async () => {
      if (!currentConfiguration?.enabled || hash(this.configuration()) !== hash(currentConfiguration)) throw unavailable();
      await live();
      const current = await this.target(selector, true);
      if (publication && current.fingerprint !== publication.fingerprint) throw denied();
      publication ??= current;
      await live();
      if (!this.configuration().enabled || hash(this.configuration()) !== hash(currentConfiguration)) throw denied();
    };
    await live();
    const configuration = { enabled: currentConfiguration?.enabled ?? false, ...selector, channel: this.channel };
    if (action === 'issueSession') {
      await newWork();
      const issued = this.dependencies.ownership.issue(before.scope);
      await newWork();
      return { ...issued, ownership: 'public_material_only' as const, execution: 'not_authorized' as const };
    }
    if (action === 'read') {
      await newWork();
      const input = aiClientPublicReadRequestSchema.parse(command);
      const publicRead = composeRequestBoundClientApplication({ db: this.dependencies.db, client: this.dependencies.client,
        guard: this.dependencies.guard, clock: this.clock }, { ...configuration, enabled: true });
      const result = await publicRead.readPublic(currentRequest, input.command);
      await newWork(); return result;
    }
    const service = new ClientPublicContinuityService({ db: this.dependencies.db, client: this.dependencies.client,
      guard: this.dependencies.guard, clock: this.clock, credentials: { current: async () => {
        if (signal?.aborted) throw denied(); return currentRequest;
      } }, anonymous: { current: async mode => this.dependencies.ownership.verify(credential, before.scope, mode) },
      publication: { assertCurrent: newWork } }, configuration);
    let result: unknown;
    switch (action) {
      case 'prepare': {
        const input = aiClientPublicPreparationRequestSchema.parse(command);
        result = await service.prepare({ operationKey: input.operationKey, command: input.command }, signal); break;
      }
      case 'readOriginal': {
        const input = aiClientPublicOperationRequestSchema.parse(command);
        result = await service.readOriginal({ operationKey: input.operationKey }, signal); break;
      }
      case 'continueOriginal': {
        const { tenantCode: _tenant, serviceCode: _service, ...input } = aiClientPublicContinuationRequestSchema.parse(command);
        result = await service.continueOriginal(input, signal); break;
      }
      case 'readContinuation': {
        const { tenantCode: _tenant, serviceCode: _service, ...input } = aiClientPublicContinuationReadRequestSchema.parse(command);
        result = await service.readContinuation(input, signal); break;
      }
      default: throw invalid();
    }
    try {
      await live();
      if (publication) await newWork();
    } catch (error) {
      if (action === 'prepare' || action === 'continueOriginal') throw new ClientPublicContinuityUnknownError(
        action === 'continueOriginal' ? 'read_original_public_continuation' : 'read_original_public_operation');
      throw error;
    }
    return result;
  }
}
