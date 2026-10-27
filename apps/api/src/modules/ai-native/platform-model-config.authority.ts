import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../common/request-identity';
import type { AiOrderRouteCredentialSource } from './order-route-context.authority';
import type { AiCurrentScopeAuthority } from './ai-scope.repository';
import type { PlatformConnectionAuthority } from './platform-model-connection';
import { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import { isAiStepExecutionContext } from './task-contract-validation';
import { ModelGatewayError, type GatewayContext } from './model-gateway.ports';

const profileIdSchema = z.string().regex(/^[A-Za-z0-9][\w.:-]{0,35}$/u);
const credentialsSchema = z.object({ authorization: z.string().min(1).max(8192), requestId: z.string().min(1).max(191), audience: z.literal('operator') }).strict();
const userSchema = z.object({ id: z.string().min(1), isActive: z.literal(true), isSaasAdmin: z.literal(true), permissions: z.array(z.string()) });

/** Bound to one validated Profile resource and current credential source.
 * The resource id is not authority; the real platform Guard and persisted
 * platform ownership must both pass before any configuration is delivered.
 * Platform management has its own actual Guard permission. It never borrows
 * tenant-management permission or grants cross-tenant content access. */
export class PlatformModelConfigurationAuthority implements PlatformConnectionAuthority, AiCurrentScopeAuthority {
  private readonly invocation: TenantModelConfigurationAuthority;
  private readonly identity: AiCurrentScopeAuthority;
  constructor(private readonly guard: Pick<ApiAuthGuard, 'canActivate'>,
    private readonly credentials: AiOrderRouteCredentialSource, private readonly profileId: string | undefined,
    invocation: AiCurrentScopeAuthority, private readonly clock: () => Date = () => new Date()) {
    if (profileId !== undefined && !profileIdSchema.safeParse(profileId).success || typeof clock !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
    this.identity = invocation;
    this.invocation = new TenantModelConfigurationAuthority(guard, credentials, invocation);
  }
  async manage(profileId: string): Promise<void> {
    if (profileId !== this.profileId) throw new ModelGatewayError('FORBIDDEN');
    await this.resolve();
  }
  async read(profileId: string): Promise<void> {
    if (profileId !== this.profileId) throw new ModelGatewayError('FORBIDDEN');
    await this.resolveRead();
  }
  invoke(context: GatewayContext) {
    // Platform consumers carry actorId only; their invocation gate is the
    // current platform identity itself, never a tenant configuration grant.
    if (!('tenantId' in context && 'workspaceId' in context)) {
      return (async () => {
        const current = structuredClone(await this.identity.resolve());
        if (!isAiStepExecutionContext(current) || current.actor.kind !== 'saas_admin'
          || current.audience !== 'operator' || current.scope.kind !== 'platform'
          || current.actor.userId !== context.actorId) throw new ModelGatewayError('FORBIDDEN');
      })();
    }
    return this.invocation.authorize(context, 'invoke');
  }
  resolve(): Promise<AiExecutionContext> { return this.current('PUT'); }
  resolveRead(): Promise<AiExecutionContext> { return this.current('GET'); }
  /** Directory is a separate current read action, not a fabricated Profile. */
  resolveDirectoryRead(): Promise<AiExecutionContext> { return this.current('GET', true); }
  private async current(method: 'GET' | 'PUT', directory = false): Promise<AiExecutionContext> {
    try {
      if (!directory && this.profileId === undefined) throw Error();
      const credential = credentialsSchema.parse(structuredClone(await this.credentials.current()));
      return await runWithRequestIdentity({}, async () => {
        const path = directory ? '/api/platform/ai/providers' : `/api/platform/ai/providers/${this.profileId}`;
        const request = { url: path, originalUrl: path, method, headers: { authorization: credential.authorization }, query: {}, user: undefined as unknown };
        if (await this.guard.canActivate(new ExecutionContextHost([request])) !== true) throw Error();
        // A request may close while the Guard awaits its identity source.
        // The old result cannot revive closed credentials or authorize a later read.
        const latest = credentialsSchema.parse(structuredClone(await this.credentials.current()));
        if (latest.authorization !== credential.authorization || latest.audience !== credential.audience) throw Error();
        const user = userSchema.parse(request.user), identity = getRequestIdentity(), now = this.clock();
        if (!identity?.isSaasAdmin || identity.staffApi || identity.userId !== user.id || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw Error();
        const context = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: credential.requestId, authorizedAt: now.toISOString(),
          audience: 'operator', actor: { kind: 'saas_admin', userId: user.id }, scope: { kind: 'platform' },
          permissions: [...user.permissions] };
        if (!isAiStepExecutionContext(context)) throw Error();
        return structuredClone(context);
      });
    } catch { throw new ModelGatewayError('FORBIDDEN'); }
  }
}
