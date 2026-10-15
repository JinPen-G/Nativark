import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ClientApiService } from '../../client/client-api.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { composeGuardedClientOriginalQuotes } from '../client-quote-original.composition';
import { createAiGuardedClientSession } from '../client-scene.composition';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiClientPolicyAuthority, clientTaskSceneSchema, type AiClientTaskDependencies } from './client-task.authority';
import { PrismaClientSceneMaterialRepository, type AiClientSceneMaterial } from './prisma-client-scene-material.repository';

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const reference = z.object({ materialRef: z.string().uuid(), expectedMaterialHash: digest }).strict();
const savedCommand = z.object({ kind: z.literal('quote_preparation'), inputHash: digest }).strict();
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const stale = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const canonical = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

/** Explicit server composition, not a model tool or public route. prepare
 * persists the current authorized parameters; confirm is a distinct human
 * request referencing the exact stored material hash. A scene/HTTP host must
 * expose confirm only to that authenticated human, never to model dispatch.
 * Existing client material storage and independent policy/entitlement gates
 * are reused. No task, approval, financial ledger or session database is added. */
export function composeClientOriginalQuotePreparation(input: {
  enabled?: boolean; guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: { current(): Promise<{ authorization: string; ip?: string }> };
  client: Pick<ClientApiService, 'prepareQuoteForOriginalOperation' | 'createQuoteForOriginalOperation' | 'readQuoteForOriginalOperation'>;
  tasks: AiClientTaskDependencies; channel: 'web' | 'wechat_miniprogram'; tenantCode: string; serviceCode: string;
  clock?: () => Date;
}) {
  const enabled = input.enabled === true, clock = input.clock ?? (() => new Date());
  const scene = clientTaskSceneSchema.parse({ sceneCode: input.tasks.sceneCode, sceneVersion: input.tasks.sceneVersion });
  const channel = z.enum(['web', 'wechat_miniprogram']).parse(input.channel);
  const tenantCode = id.parse(input.tenantCode), serviceCode = id.parse(input.serviceCode);
  const repository = new PrismaClientSceneMaterialRepository(input.tasks.db);
  const session = createAiGuardedClientSession(input.guard, input.credentials);
  const quotes = composeGuardedClientOriginalQuotes(input);
  const authority = new AiClientPolicyAuthority(input.tasks, scene, randomUUID(), clock);
  const current = async () => {
    if (!enabled) throw unavailable();
    const identity = await session.current(), scope = await repository.resolveScope(tenantCode, serviceCode);
    if (identity.tenantCode !== tenantCode || identity.workspaceCode !== serviceCode
      || identity.tenantId !== scope.tenantId || identity.workspaceId !== scope.workspaceId) throw denied();
    return { identity, scope: { ...scope, channel, principalKind: identity.customerType,
      principalHash: requestFingerprint({ ...scope, channel, customerId: identity.customerId,
        customerType: identity.customerType, sessionId: identity.sessionId }) }, bindingHash: requestFingerprint(identity) };
  };
  const grant = async (bound: Awaited<ReturnType<typeof current>>, operation: 'create' | 'read' | 'execute') =>
    authority.authorize({ ...bound.scope, identity: bound.identity }, operation);
  const check = async (bound: Awaited<ReturnType<typeof current>>) => {
    if (requestFingerprint(await current()) !== requestFingerprint(bound)) throw denied();
  };
  const decode = (row: AiClientSceneMaterial) => {
    const command = savedCommand.safeParse(row.command);
    const material = z.object({ version: z.literal('client-prequote-1'), input: z.unknown(), normalized: z.unknown(),
      inputHash: digest, configurationHash: digest }).strict().safeParse(row.material);
    const publication = { tenantCode, serviceCode, channel };
    if (!command.success || !material.success || row.publicationHash !== requestFingerprint(publication)
      || requestFingerprint(row.publication) !== requestFingerprint(publication) || row.inputHash !== requestFingerprint(command.data)
      || row.materialHash !== requestFingerprint(material.data) || command.data.inputHash !== requestFingerprint(material.data.input)
      || material.data.inputHash !== requestFingerprint(material.data.normalized)) throw unavailable();
    return material.data;
  };
  const load = async (value: unknown, operation: 'read' | 'execute') => {
    const parsed = reference.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const bound = await current(), row = await repository.findSource(bound.scope, parsed.data.materialRef);
    if (!row || row.materialHash !== parsed.data.expectedMaterialHash || row.bindingHash !== bound.bindingHash) throw stale();
    const material = decode(row), permission = await grant(bound, operation);
    if (operation === 'execute' && row.expiresAt <= clock()) throw stale();
    await check(bound);
    return { bound, row, material, permission };
  };
  const packet = (row: AiClientSceneMaterial) => ({ materialRef: row.id, materialHash: row.materialHash,
    inputHash: decode(row).inputHash, revision: row.revision, expiresAt: row.expiresAt.toISOString(),
    preparation: 'normalized_parameters' as const, eligibility: 'not_attested' as const,
    quotePersistence: 'not_attempted' as const, inventoryReservation: 'not_attempted' as const,
    humanAction: 'explicit_confirmation_required' as const });
  return Object.freeze({
    /** Observe an uncertain material INSERT without attempting another write.
     * Absence is unknown, not evidence that preparation did not commit. */
    async readPreparationOperation(value: unknown) {
      const parsed = z.object({ operationKey: id, input: z.unknown() }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const bound = await current();
      await grant(bound, 'read');
      const row = await repository.findOperation(bound.scope, parsed.data.operationKey);
      if (!row) {
        await check(bound);
        await grant(bound, 'read');
        return { state: 'unknown' as const, operationKey: parsed.data.operationKey,
          retryable: false as const, execution: 'read_only' as const };
      }
      const command = { kind: 'quote_preparation' as const, inputHash: requestFingerprint(canonical(parsed.data.input)) };
      if (row.inputHash !== requestFingerprint(command) || row.bindingHash !== bound.bindingHash) throw stale();
      decode(row); await check(bound); await grant(bound, 'read');
      return { state: 'observed' as const, ...packet(row), retryable: false as const,
        execution: 'read_only' as const, freshness: 'recheck_at_confirmation' as const };
    },
    async prepare(value: unknown) {
      const parsed = z.object({ operationKey: id, input: z.unknown() }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const bound = await current(), permission = await grant(bound, 'create');
      const raw = canonical(parsed.data.input), command = { kind: 'quote_preparation' as const, inputHash: requestFingerprint(raw) };
      const existing = await repository.findOperation(bound.scope, parsed.data.operationKey);
      if (existing) {
        if (existing.inputHash !== requestFingerprint(command) || existing.bindingHash !== bound.bindingHash) throw stale();
        decode(existing); await check(bound);
        return { ...packet(existing), replayed: true, freshness: 'recheck_at_confirmation' as const };
      }
      const normalized = await quotes.prepare({ input: raw });
      if (normalized.tenantId !== bound.scope.tenantId || normalized.workspaceId !== bound.scope.workspaceId
        || normalized.customerId !== bound.identity.customerId) throw denied();
      const material = canonical({ version: 'client-prequote-1', input: raw, normalized: normalized.request,
        inputHash: normalized.inputHash, configurationHash: normalized.configurationHash });
      const latest = await grant(bound, 'create');
      if (latest.policyHash !== permission.policyHash) throw stale();
      await check(bound);
      const now = clock(), row: AiClientSceneMaterial = { id: randomUUID(), ...bound.scope,
        bindingHash: bound.bindingHash, publicationHash: requestFingerprint({ tenantCode, serviceCode, channel }),
        publication: { tenantCode, serviceCode, channel }, operationKey: parsed.data.operationKey,
        inputHash: requestFingerprint(command), materialHash: requestFingerprint(material), command, material,
        revision: 1, createdAt: now, expiresAt: new Date(Math.min(now.getTime() + 300000, permission.policy.expiresAt.getTime())) };
      const saved = await repository.save(row);
      if (saved.row.bindingHash !== bound.bindingHash || saved.row.inputHash !== row.inputHash) throw stale();
      decode(saved.row); await check(bound);
      return { ...packet(saved.row), replayed: saved.replayed, freshness: 'recheck_at_confirmation' as const };
    },
    async confirm(value: unknown) {
      const { bound, row, material, permission } = await load(value, 'execute');
      const currentParameters = await quotes.prepare({ input: material.input });
      if (currentParameters.inputHash !== material.inputHash || currentParameters.configurationHash !== material.configurationHash) throw stale();
      await check(bound);
      if ((await grant(bound, 'execute')).policyHash !== permission.policyHash) throw stale();
      const latest = await repository.findSource(bound.scope, row.id);
      // Parameter normalization, current authority and storage reads may wait.
      // A material that expired during those waits cannot initiate the R1 quote
      // write, even if its content and current policy are otherwise unchanged.
      if (!latest || requestFingerprint(latest) !== requestFingerprint(row) || latest.expiresAt <= clock()) throw stale();
      const result = await quotes.create({ reference: `${row.id}:${row.materialHash}`, input: material.input,
        prepared: { inputHash: material.inputHash, configurationHash: material.configurationHash } });
      await check(bound);
      if ((await grant(bound, 'execute')).policyHash !== permission.policyHash) throw denied();
      return { ...result, source: { materialRef: row.id, materialHash: row.materialHash },
        confirmation: 'parameters_only_not_order_approval' as const };
    },
    async readOriginal(value: unknown) {
      const { bound, row } = await load(value, 'read');
      const result = await quotes.readOriginal({ reference: `${row.id}:${row.materialHash}` });
      await check(bound);
      return { ...result, source: { materialRef: row.id, materialHash: row.materialHash } };
    },
  });
}
