/** Immutable platform category material and original metadata creation receipt.
 * Current read and new-generation authority are separate. Neither publication
 * nor a recovered receipt signs policies, leases a Run or dispatches a model. */
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AiTaskOriginalRequest, type AiTask } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION } from '@rental-os/shared';
import { AiTaskCreationRepository } from '../ai-task-creation.repository';
import { AiTaskRepositoryError, aiTaskAccessFromContext } from '../ai-task.repository';
import type { AiScopeRepository } from '../ai-scope.repository';
import { taskModelIdentity, taskModelMaterialSchema } from '../model-input/task-model-input';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import type { PlatformTaskPlanPolicyReader } from '../platform-capability-probe/platform-probe.authorization';
import type { CategoryProposalMaterial, CategoryProposalReference } from './category-proposal.application';
import { CATEGORY_PROPOSAL_SCENE } from './category-platform-gateway.composition';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const version = 'category-model-original-1';
const material = z.custom<CategoryProposalMaterial>(value => !!value && typeof value === 'object'
  && (value as CategoryProposalMaterial).version === 'category-proposal-material-1');
const payloadSchema = z.object({ version: z.literal(version), operationKey: id.max(128), goal: z.string().min(1).max(2000), material,
  modelMaterial: taskModelMaterialSchema, generation: z.object({ platformProfileId: id.max(36), sceneVersion: id.max(64),
    priceVersion: id.max(64), maxOutputTokens: z.number().int().min(1).max(32768), configurationHash: digest }).strict(),
  registrationRef: id, limits: aiTaskRunnerLimitsSchema }).strict();
type Payload = z.infer<typeof payloadSchema>;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED'), unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const originalHash = (row: Pick<AiTaskOriginalRequest, 'scopeId' | 'audience' | 'ownerKind' | 'ownerId' | 'contractVersion' | 'sceneCode'
  | 'sceneVersion' | 'requestKey' | 'revision' | 'payload' | 'authorizationBindingHash' | 'policyRevision' | 'policyHash' | 'expiresAt'>) =>
  hash({ scopeId: row.scopeId, audience: row.audience, ownerKind: row.ownerKind, ownerId: row.ownerId,
    contractVersion: row.contractVersion, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion,
    requestKey: row.requestKey, revision: row.revision, payload: row.payload, authorizationBindingHash: row.authorizationBindingHash,
    policyRevision: row.policyRevision, policyHash: row.policyHash, expiresAt: row.expiresAt.toISOString() });
export const categoryTaskCreationKey = (key: string) => `category-task:${hash({ operationKey: id.max(128).parse(key) })}`;

export class CategoryModelOriginalRepository {
  constructor(private readonly db: PrismaClient, private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    private readonly planPolicy: Pick<PlatformTaskPlanPolicyReader, 'read'>, private readonly assertNew: () => Promise<void>,
    private readonly readCurrentPrincipal: () => Promise<CategoryProposalMaterial['principal']>, private readonly clock: () => Date = () => new Date()) {}

  async access() {
    const current = await this.scopes.resolveCurrent(), context = current.context;
    if (current.scope.kind !== 'PLATFORM' || context.scope.kind !== 'platform' || context.actor.kind !== 'saas_admin'
      || context.audience !== 'operator') throw denied();
    const principal = await this.readCurrentPrincipal();
    if (principal.actorId !== context.actor.userId || principal.audience !== 'operator' || principal.isSaasAdmin !== true) throw denied();
    const again = await this.scopes.resolveCurrent();
    if (again.scope.id !== current.scope.id || taskModelIdentity(again.context) !== taskModelIdentity(context)) throw denied();
    return { context, principal, owner: { scopeId: current.scope.id, ownerKind: 'SAAS_ADMIN' as const,
      audience: 'OPERATOR' as const, ownerId: context.actor.userId }, binding: hash({ scope: current.scope.id, identity: taskModelIdentity(context), principal }) };
  }
  private checked(row: AiTaskOriginalRequest, access: Awaited<ReturnType<CategoryModelOriginalRepository['access']>>) {
    if (Object.entries(access.owner).some(([key, value]) => row[key as keyof typeof row] !== value)
      || row.contractVersion !== version || row.sceneCode !== CATEGORY_PROPOSAL_SCENE || row.revision !== 1
      || row.previousRequestId !== null || row.status !== 'STORED' || row.erasedAt !== null
      || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())) throw unavailable();
    const payload = payloadSchema.parse(structuredClone(row.payload));
    const { materialHash, ...facts } = payload.material;
    if (hash(facts) !== materialHash || hash(payload.material.principal) !== hash(access.principal)
      || payload.operationKey !== row.requestKey || payload.generation.sceneVersion !== row.sceneVersion
      || row.contentHash !== originalHash(row) || payload.modelMaterial.maxOutputTokens !== payload.generation.maxOutputTokens) throw denied();
    return { row, payload };
  }
  async read(operationKey: string) {
    operationKey = id.max(128).parse(operationKey);
    const before = await this.access();
    const row = await this.db.aiTaskOriginalRequest.findFirst({ where: { ...before.owner, requestKey: operationKey,
      contractVersion: version, sceneCode: CATEGORY_PROPOSAL_SCENE } });
    const after = await this.access();
    if (after.binding !== before.binding) throw denied();
    return row ? this.checked(row, after) : null;
  }
  async readById(inputId: string) {
    inputId = id.max(36).parse(inputId);
    const before = await this.access();
    const row = await this.db.aiTaskOriginalRequest.findFirst({ where: { ...before.owner, id: inputId,
      contractVersion: version, sceneCode: CATEGORY_PROPOSAL_SCENE } });
    if (!row) throw unavailable();
    const original = await this.read(row.requestKey);
    if (!original || original.row.id !== inputId || (await this.access()).binding !== before.binding) throw denied();
    return original;
  }
  async publish(input: Omit<Payload, 'version' | 'registrationRef' | 'limits'>) {
    input = structuredClone(input);
    const existing = await this.read(input.operationKey);
    if (existing) {
      if (existing.payload.goal !== input.goal || existing.payload.material.materialHash !== input.material.materialHash) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      return { ...existing, created: false };
    }
    await this.assertNew(); const before = await this.access(), policy = await this.planPolicy.read();
    if (policy.state !== 'configured' || !policy.enabled || Date.parse(policy.expiresAt) <= this.clock().getTime()) throw unavailable();
    const payload = payloadSchema.parse({ ...input, version, limits: policy.limits, registrationRef: `category-model:${hash({ operationKey: input.operationKey })}` });
    if (hash(payload.material.principal) !== hash(before.principal) || Buffer.byteLength(JSON.stringify(payload), 'utf8') > 524288) throw denied();
    const row = { ...before.owner, id: randomUUID(), contractVersion: version, sceneCode: CATEGORY_PROPOSAL_SCENE,
      sceneVersion: payload.generation.sceneVersion, requestKey: payload.operationKey, revision: 1,
      payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue, authorizationBindingHash: taskModelIdentity(before.context),
      policyRevision: policy.revision, policyHash: hash(policy), expiresAt: new Date(policy.expiresAt), previousRequestId: null,
      status: 'STORED' as const, erasedAt: null };
    let attempted = false;
    try {
      await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_scopes WHERE id = ${row.scopeId} FOR UPDATE`);
        await this.assertNew();
        if ((await this.access()).binding !== before.binding || hash(await this.planPolicy.read()) !== hash(policy)) throw denied();
        const previous = await tx.aiTaskOriginalRequest.findFirst({ where: { ...before.owner, requestKey: row.requestKey } });
        if (previous) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        attempted = true;
        await tx.aiTaskOriginalRequest.create({ data: { ...row, contentHash: originalHash(row as unknown as AiTaskOriginalRequest) } });
        await this.assertNew();
        if ((await this.access()).binding !== before.binding || hash(await this.planPolicy.read()) !== hash(policy)) throw denied();
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      const saved = await this.read(input.operationKey);
      if (!saved || saved.row.id !== row.id) throw unavailable();
      return { ...saved, created: true };
    } catch (error) {
      if (attempted) throw Object.assign(new Error('AI_RESULT_UNKNOWN'), { code: 'AI_RESULT_UNKNOWN' });
      throw error;
    }
  }
  private async creationAuthority(sceneCode: string, inputRef: string, execute: boolean) {
    if (sceneCode !== CATEGORY_PROPOSAL_SCENE) throw denied();
    const before = await this.access(), original = await this.readById(inputRef);
    if (execute) {
      await this.assertNew();
      if (original.row.expiresAt <= this.clock() || original.row.creationClosedAt !== null
        || original.row.policyHash !== hash(await this.planPolicy.read())) throw unavailable();
    }
    if ((await this.access()).binding !== before.binding) throw denied();
    return { context: before.context, sceneCode, sceneVersion: original.row.sceneVersion,
      inputRef: original.row.id, inputRevision: original.row.revision, inputHash: original.row.contentHash };
  }
  async createTask(original: { row: AiTaskOriginalRequest; payload: Payload }) {
    const command = { sceneCode: CATEGORY_PROPOSAL_SCENE, inputRef: original.row.id, creationKey: categoryTaskCreationKey(original.row.requestKey) };
    const receipt = await this.readCreation(original);
    if (receipt.state === 'observed' && receipt.task) return receipt.task;
    if (receipt.state === 'unknown') throw Object.assign(new Error('AI_RESULT_UNKNOWN'), { code: 'AI_RESULT_UNKNOWN' });
    return new AiTaskCreationRepository(this.db, {
      resolve: async (scene, ref) => ({ ...await this.creationAuthority(scene, ref, true), creationAllowed: true }),
      assertCreationOpen: async (tx, value, grant) => {
        const row = await tx.aiTaskOriginalRequest.findFirst({ where: { id: value.inputRef, scopeId: grant.scopeId } });
        if (!row || row.contentHash !== grant.inputHash || row.creationClosedAt !== null || row.status !== 'STORED'
          || row.expiresAt <= this.clock()) throw denied();
      }
    }, this.clock).create(command);
  }
  readCreation(original: { row: AiTaskOriginalRequest; payload: Payload }) {
    return AiTaskCreationRepository.receiptReader(this.db, { resolve: (scene, ref) => this.creationAuthority(scene, ref, false) }, this.clock)
      .readCreation({ sceneCode: CATEGORY_PROPOSAL_SCENE, inputRef: original.row.id, creationKey: categoryTaskCreationKey(original.row.requestKey) });
  }
  async reference(original: { row: AiTaskOriginalRequest; payload: Payload }): Promise<CategoryProposalReference | null> {
    const receipt = await this.readCreation(original);
    if (receipt.state !== 'observed' || !receipt.task) return null;
    return { operationKey: original.row.requestKey, inputId: original.row.id, taskId: receipt.task.taskId,
      runId: receipt.task.runId, registrationRef: original.payload.registrationRef, materialHash: original.payload.material.materialHash };
  }
  async provenance(task: AiTask) {
    if (task.scopeKind !== 'PLATFORM' || task.ownerKind !== 'SAAS_ADMIN' || task.audience !== 'OPERATOR'
      || task.contractVersion !== AI_TASK_DRAFT_VERSION || !task.inputRef) throw denied();
    const original = await this.readById(task.inputRef), ref = await this.reference(original);
    if (!ref || ref.taskId !== task.id || task.creationKey !== categoryTaskCreationKey(ref.operationKey)
      || task.inputRevision !== original.row.revision || task.inputHash !== original.row.contentHash
      || task.sceneCode !== original.row.sceneCode || task.sceneVersion !== original.row.sceneVersion || task.scopeId !== original.row.scopeId
      || task.ownerId !== original.row.ownerId) throw denied();
    return { authorizationHash: original.row.authorizationBindingHash, bindingHash: hash({ inputId: original.row.id,
      contentHash: original.row.contentHash, reference: ref, creationFingerprint: task.creationFingerprint }) };
  }
}
