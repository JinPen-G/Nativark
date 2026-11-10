/** Original canonical request scope under a caller-owned Native transaction.
 * Uses only the original catalog Guard callback's subject, never issuer subject,
 * Web credentials, model identity fields or a second role resolver. Does not
 * create scopes/requests/goals, execute policy, audit or grant durable authority. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import type { OriginalMcpReadCallRef } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import { AiScopeRepository } from '../ai-native/ai-scope.repository';
import { isAiStepExecutionContext } from '../ai-native/task-contract-validation';
import type { AiOriginalRequestAccess } from '../ai-native/task-request/original-request.authority';
import { freezeOriginalInput } from '../ai-native/task-request/original-request.validation';
import type { OriginalMcpCatalogReadContext, OriginalMcpReadSubject } from './original-mcp-read-context';

type Native = Pick<Prisma.TransactionClient, 'aiScope'>;
export interface OriginalMcpRequestScopeSource {
  /** Existing-scope observation only. Owner holds identity/grant fences and owns
   * coherent isolation, cancellation, final policy/adoption and commit/unknown. */
  currentIn(call: OriginalMcpReadCallRef, native: Native, signal: AbortSignal): Promise<AiOriginalRequestAccess>;
}
const unavailable = () => new Error('Original MCP request scope unavailable');
function fields(raw: unknown, names: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
    || Reflect.ownKeys(raw).length !== names.length) throw unavailable();
  const properties = Object.getOwnPropertyDescriptors(raw), captured: Record<string, unknown> = {};
  for (const name of names) {
    const field = properties[name];
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw unavailable();
    captured[name] = field.value;
  }
  return captured;
}
/** Internal call snapshot reused by the request-policy observer. Never expose
 * this credential-bearing object to models, HTTP results or ordinary logs. */
export function captureOriginalMcpRequestCall(raw: OriginalMcpReadCallRef): OriginalMcpReadCallRef {
  const call = fields(raw, ['callId', 'authorization', 'toolName', 'inputHash']);
  const a = fields(call.authorization, ['subject', 'token', 'clientId', 'scopes', 'resource']);
  if (typeof call.callId !== 'string' || typeof call.toolName !== 'string' || typeof call.inputHash !== 'string'
    || typeof a.subject !== 'string' || typeof a.token !== 'string' || typeof a.clientId !== 'string' || typeof a.resource !== 'string'
    || !Array.isArray(a.scopes) || Object.getPrototypeOf(a.scopes) !== Array.prototype
    || Reflect.ownKeys(a.scopes).length !== a.scopes.length + 1) throw unavailable();
  const scopes: string[] = [];
  for (let i = 0; i < a.scopes.length; i++) {
    const field = Object.getOwnPropertyDescriptor(a.scopes, String(i));
    if (!field?.enumerable || !Object.hasOwn(field, 'value') || typeof field.value !== 'string') throw unavailable();
    scopes.push(field.value);
  }
  return freezeOriginalInput({ callId: call.callId, toolName: call.toolName, inputHash: call.inputHash,
    authorization: { subject: a.subject, token: a.token, clientId: a.clientId, scopes, resource: a.resource } });
}
/** Bind one real original catalog context. No ambient identity/credential fallback;
 * missing or settled callback must fail before canonical storage is read. */
export function createOriginalMcpRequestScopeSource(context: OriginalMcpCatalogReadContext,
  clock: () => Date = () => new Date()): OriginalMcpRequestScopeSource {
  if (typeof context?.current !== 'function' || typeof clock !== 'function') throw unavailable();
  const subjectFor = context.current.bind(context);
  return Object.freeze({ async currentIn(raw: OriginalMcpReadCallRef, native: Native, signal: AbortSignal): Promise<AiOriginalRequestAccess> {
    try {
      const live = () => { if (signal.aborted) throw unavailable(); };
      live();
      const call = captureOriginalMcpRequestCall(raw);
      if (!native || '$transaction' in native || typeof native.aiScope?.findFirst !== 'function') throw unavailable();
      const delegate = native.aiScope;
      let bound: OriginalMcpReadSubject | undefined;
      // A callback can settle during current-context awaits. Check again at the
      // actual storage dispatch, without reacquiring original identity/grant locks.
      const findFirst = new Proxy(delegate.findFirst.bind(delegate), { apply(target, owner, args) {
        live();
        if (!bound || !isDeepStrictEqual(bound, structuredClone(subjectFor(call)))) throw unavailable();
        return Reflect.apply(target, owner, args);
      } });
      const aiScope = new Proxy(delegate, { get(target, property, receiver) {
        return property === 'findFirst' ? findFirst : Reflect.get(target, property, receiver);
      } });
      const current = (): AiExecutionContext => {
        live();
        const subject = structuredClone(subjectFor(call)), now = clock();
        if (!(now instanceof Date) || !Number.isFinite(now.getTime())
          || !subject.userId || !subject.tenantId || !subject.workspaceId || subject.audience !== 'operator'
          || !subject.permissions || !subject.dataScope || !subject.locationScope
          || typeof subject.grantId !== 'string' || !subject.grantId
          || !Number.isSafeInteger(subject.grantRevision) || subject.grantRevision < 1 || subject.grantRevision > 2147483647
          || (bound && !isDeepStrictEqual(bound, subject))) throw unavailable();
        bound ??= subject;
        const candidate = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: call.callId, authorizedAt: now.toISOString(),
          audience: 'operator', actor: { kind: 'user', userId: subject.userId },
          scope: { kind: 'workspace', tenantId: subject.tenantId, workspaceId: subject.workspaceId },
          access: { permissions: [...subject.permissions], dataScope: subject.dataScope, locationScope: structuredClone(subject.locationScope),
            ...(subject.organizationId === undefined ? {} : { organizationId: subject.organizationId }) } };
        if (!isAiStepExecutionContext(candidate)) throw unavailable();
        return candidate;
      };
      // Original normalizer, scope-key checks, context binding and existing-row
      // projection remain in the original repository; only its database is Native.
      const scopes = new AiScopeRepository({ aiScope }, { resolve: async () => current() }, clock);
      const result = await scopes.resolveCurrent();
      live();
      if (result.scope.kind !== 'WORKSPACE' || !bound || !isDeepStrictEqual(bound, structuredClone(subjectFor(call)))) throw unavailable();
      live();
      return freezeOriginalInput(structuredClone({ scopeId: result.scope.id, context: result.context }));
    } catch { throw unavailable(); }
  } });
}
