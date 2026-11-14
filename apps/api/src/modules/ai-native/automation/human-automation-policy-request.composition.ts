import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthService } from '../../auth/auth.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../../common/request-identity';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { HumanAutomationPolicyManagementService } from './human-automation-policy-management.service';
import { AutomationManagementError } from './automation-management.validation';
import { waitForTaskApplicationDependency } from '../runner/prisma-task-application';
import type { IncomingMessage } from 'node:http';

export type HumanAutomationPolicyHttpRequest = { headers: { authorization?: unknown } } & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
export type HumanAutomationPolicyRequestAction = 'discover' | 'read' | 'preview' | 'prepare' | 'prepareConfirmed'
  | 'preparation' | 'review' | 'operation' | 'commit' | 'commitConfirmed';
export type HumanAutomationPolicyRequestDependencies = {
  db: ConstructorParameters<typeof HumanAutomationPolicyManagementService>[0];
  auth: Pick<AuthService, 'resolveAccessContext'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  clock?: () => Date;
};
const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const unavailable = () => new AutomationManagementError('unavailable');
const conflict = () => new AutomationManagementError('conflict');
const requirePort = (port: unknown, methods: string[]) => {
  if (!port || methods.some(method => typeof (port as Record<string, unknown>)[method] !== 'function')) throw unavailable();
};

export class HumanAutomationPolicyRequestFactory {
  private readonly dependencies: HumanAutomationPolicyRequestDependencies;
  constructor(input: HumanAutomationPolicyRequestDependencies) {
    if (!input || Object.keys(input).some(key => !['db', 'auth', 'guard', 'clock'].includes(key))
      || input.clock !== undefined && typeof input.clock !== 'function') throw unavailable();
    requirePort(input.auth, ['resolveAccessContext']);
    requirePort(input.guard, ['canActivate']);
    requirePort(input.db, ['$transaction']);
    for (const name of ['aiScope', 'businessWorkspace', 'aiTaskPlanPolicy', 'aiAutomationManagementGrant'] as const) requirePort(input.db[name], ['findFirst']);
    requirePort(input.db.rentalFulfillmentLocation, ['findMany']);
    for (const name of ['aiAutomationSubject', 'aiAutomationPolicy'] as const) requirePort(input.db[name], ['findFirst', 'create', 'updateMany']);
    for (const name of ['aiAutomationPolicyPreparation', 'aiAutomationPolicyManagementOperation'] as const) requirePort(input.db[name], ['findFirst', 'create']);
    this.dependencies = { ...input };
  }

  /** Only an operator Bearer is accepted. Desired settings are proposals, never
   * credentials or grants. Each call owns and then closes its service graph. */
  async call(request: HumanAutomationPolicyHttpRequest, action: HumanAutomationPolicyRequestAction, value: unknown, signal?: AbortSignal) {
    const header = bearer.safeParse(request?.headers?.authorization);
    if (!header.success) throw unavailable();
    let command: unknown;
    try { command = structuredClone(value); if (Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8') > 65536) throw Error(); }
    catch { throw new AutomationManagementError('invalid_input'); }
    const credential = Object.freeze({ authorization: header.data, audience: 'operator' as const, requestId: randomUUID() });
    const server = this.dependencies, clock = server.clock ?? (() => new Date());
    let active = true, initialIdentity: string | undefined;
    const close = () => { active = false; };
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) close();
    const write = action === 'prepare' || action === 'commit' || action === 'prepareConfirmed' || action === 'commitConfirmed';
    let writeReturned = false;
    const credentials = { current: async () => {
      if (!active) throw unavailable();
      return { ...credential };
    } };
    const auth: Pick<AuthService, 'resolveAccessContext'> = { resolveAccessContext: async (authorization, options) => {
      if (!active || authorization !== credential.authorization || options?.audience !== 'operator') throw unavailable();
      const access = structuredClone(await server.auth.resolveAccessContext(authorization, options));
      if (!access) throw unavailable();
      const context = await new AiTaskCurrentIdentityAuthority({ resolveAccessContext: async () => access }, credentials, clock).resolve();
      if (context.audience !== 'operator' || context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
        || !('access' in context) || context.access.dataScope !== 'all') throw unavailable();
      const fingerprint = hash({ actor: context.actor, audience: context.audience, scope: context.scope,
        access: context.access, organizationId: access.user.organizationId ?? null });
      if (initialIdentity !== undefined && fingerprint !== initialIdentity) throw unavailable();
      initialIdentity = fingerprint;
      return access;
    } };
    const identity = new AiTaskCurrentIdentityAuthority(auth, credentials, clock);
    const guard: Pick<ApiAuthGuard, 'canActivate'> = { canActivate: async execution => {
      await identity.resolve();
      if (await server.guard.canActivate(execution) !== true) throw unavailable();
      const context = await identity.resolve(), stored = getRequestIdentity();
      if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || !('access' in context)
        || !stored || stored.userId !== context.actor.userId || stored.tenantId !== context.scope.tenantId
        || stored.workspaceId !== context.scope.workspaceId || stored.staffApi || stored.isSaasAdmin
        || stored.dataScope !== 'all' || hash(stored.locationScope) !== hash(context.access.locationScope)) throw unavailable();
      return true;
    } };
    try {
      return await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
        await identity.resolve();
        const service = new HumanAutomationPolicyManagementService(server.db, { auth, guard, credentials }, clock);
        const stable = async <T>(read: () => Promise<T>): Promise<T> => {
          const result = await read();
          if (hash(result) !== hash(await read())) throw conflict();
          return result;
        };
        const execute = async () => {
          switch (action) {
            case 'discover': return stable(() => service.discover(command));
            case 'read': return stable(() => service.read(command));
            case 'preview': return stable(() => service.preview(command));
            case 'preparation': return stable(() => service.preparation(command));
            case 'review': return stable(() => service.review(command));
            case 'operation': return stable(() => service.operation(command));
            case 'prepareConfirmed': {
              const result = await service.prepareConfirmed(command);
              writeReturned = true;
              if (result.state !== 'unknown' && hash(result) !== hash(await service.review({ preparationId: result.preparationId }))) throw conflict();
              return result;
            }
            case 'commitConfirmed': {
              const result = await service.commitConfirmed(command);
              writeReturned = true;
              if (result.state === 'observed' && hash(result) !== hash(await service.operation({ operationKey: result.operationKey }))) throw conflict();
              return result;
            }
            case 'prepare': {
              const result = await service.prepare(command);
              writeReturned = true;
              if (result.state !== 'unknown' && hash(result) !== hash(await service.review({ preparationId: result.preparationId }))) throw conflict();
              return result;
            }
            case 'commit': {
              const result = await service.commit(command);
              writeReturned = true;
              if (result.state === 'observed' && hash(result) !== hash(await service.operation({ operationKey: result.operationKey }))) throw conflict();
              return result;
            }
            default: throw new AutomationManagementError('invalid_input');
          }
        };
        const result = await execute();
        writeReturned = write;
        await identity.resolve();
        return result;
      }), write, signal);
    } catch (error) {
      if (writeReturned || error instanceof Error && 'code' in error && error.code === 'AI_RESULT_UNKNOWN') throw new AutomationManagementError('result_unknown');
      throw error;
    } finally { close(); signal?.removeEventListener('abort', close); }
  }
}
