/** Bind an opted-in SaaS route to the original Guard store and signed session. */
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PlatformAuthService, RegisteredCoreHttpAccess } from '@rental-os/platform-server';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import { ModelGatewayError } from '@rental-os/platform-server/ai-gateway';
import { captureAiRequestBinding } from '../request-binding';

const bearer = z.string().max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const denied = () => new ModelGatewayError('FORBIDDEN');

export function withPlatformAiHttpAccess(permissionFor: (method: string, path: string) => string | undefined,
  original?: RegisteredCoreHttpAccess): RegisteredCoreHttpAccess {
  return Object.freeze({
    registered(method: string, path: string, audience: 'operator') {
      return audience === 'operator' && !!permissionFor(method, path) || original?.registered(method, path, audience) === true;
    },
    async authorize(method: string, path: string) {
      const permission = permissionFor(method, path);
      if (!permission) {
        if (!original) throw new ForbiddenException('接口未登记');
        return original.authorize(method, path);
      }
      const current = getRequestIdentity();
      if (!current?.isSaasAdmin || current.audience !== 'operator' || current.staffApi || !current.accessSession
        || !hasEffectivePermission(current.permissions ?? [], permission)) throw new ForbiddenException('缺少当前平台 AI 管理权限');
    }
  });
}

export function bindPlatformAiRequest(auth: Pick<PlatformAuthService, 'resolveAccessContext'>,
  source: { headers: { authorization?: unknown } }, permission: string, signal?: AbortSignal) {
  const header = bearer.safeParse(source?.headers?.authorization);
  if (!header.success || signal?.aborted) throw denied();
  const binding = captureAiRequestBinding(denied), identity = binding.identity, requestId = randomUUID();
  const assertActive = () => { binding.assertCurrent(); if (signal?.aborted) throw denied(); };
  const resolve = async (): Promise<AiExecutionContext> => {
    assertActive();
    const session = identity.accessSession;
    if (identity.isSaasAdmin !== true || identity.audience !== 'operator' || identity.staffApi || identity.workspaceId !== undefined
      || !identity.tenantId || !identity.userId || !session || session.expiresAt <= Date.now() / 1000
      || !hasEffectivePermission(identity.permissions ?? [], permission)) throw denied();
    const current = await auth.resolveAccessContext(header.data);
    assertActive();
    const user = current?.tenantUser, currentSession = current?.accessSession;
    if (!user || user.id !== identity.userId || user.tenantId !== identity.tenantId || user.isSaasAdmin !== true
      || !user.isActive || user.mustChangePassword || !currentSession || currentSession.sessionId !== session.sessionId
      || currentSession.expiresAt !== session.expiresAt || currentSession.expiresAt <= Date.now() / 1000
      || currentSession.workspaceId !== session.workspaceId || !hasEffectivePermission(user.permissions, permission)) throw denied();
    return { contractVersion: AI_CONTRACT_DRAFT_VERSION, audience: 'operator', actor: { kind: 'saas_admin', userId: user.id },
      scope: { kind: 'platform' }, permissions: [...user.permissions], requestId, authorizedAt: new Date().toISOString() };
  };
  return { resolve, assertActive, close: binding.close };
}
