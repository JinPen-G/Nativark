/** Publish the fixed text check on the original tenant policy table. The
 * caller supplies the current tenant principal; no startup seed grants work. */
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import { requestFingerprint as hash } from '@rental-os/platform-contracts/request-fingerprint';
import { AiTaskRepositoryError } from '../task-errors';
import { aiTaskRunnerLimitsSchema } from '../task-runner-resources';
import { WorkCenterConversations } from './conversations';
import { SCENE, SCENE_VERSION, conflict, leaseMs, policyRow, policyKey, retentionMs, tools, unavailable, type Owner, type Tx } from './scene';

const action = 'ai_task_plan_policy_changed';
const receiptVersion = 'public-text-policy-operation-1';
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const revision = z.number().int().min(1).max(4294967294);
const expiresAt = z.string().datetime({ offset: true });
const snapshot = z.object({ revision, enabled: z.boolean(), expiresAt, limits: aiTaskRunnerLimitsSchema }).strict();
const commandSchema = snapshot.omit({ revision: true }).extend({ operationKey: key, expectedRevision: revision.nullable() }).strict();
const evidence = z.object({ version: z.literal(receiptVersion), scopeId: z.string(), sceneCode: z.literal(SCENE),
  sceneVersion: z.literal(SCENE_VERSION), expectedRevision: revision.nullable(), operationKey: key,
  commandHash: digest, savedPolicyHash: digest, savedPolicy: snapshot, dispatch: z.literal('not_granted') }).strict();
const projection = ({ revision, enabled, limits, expiresAt }: NonNullable<Awaited<ReturnType<typeof policyRow>>>) =>
  ({ revision, enabled, limits, expiresAt: expiresAt.toISOString() });

export class WorkCenterPublication {
  constructor(private readonly db: Pick<PrismaClient, 'operationLog' | 'aiTaskPlanPolicy'>,
    private readonly conversations: WorkCenterConversations, private readonly clock: () => Date) {}

  async read() {
    const owner = await this.conversations.current(), row = await policyRow(this.db, owner.scopeId);
    await this.conversations.same(owner);
    return { policy: row && projection(row), execution: 'not_granted' as const };
  }

  private async original(db: Pick<Tx, 'operationLog'>, owner: Owner, operationKey: string) {
    const { scopeId, tenantId, ownerId } = owner;
    const digest = hash([receiptVersion, scopeId, tenantId, ownerId, operationKey]);
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const row = await db.operationLog.findUnique({ where: { id } });
    if (!row) return { id, prior: null };
    const parsed = evidence.safeParse(row.detail);
    if (row.id !== id || row.tenantId !== tenantId || row.userId !== ownerId || row.workspaceId !== null || row.action !== action
      || !parsed.success || parsed.data.scopeId !== scopeId || parsed.data.operationKey !== operationKey
      || parsed.data.savedPolicy.revision !== (parsed.data.expectedRevision ?? 0) + 1
      || hash(parsed.data.savedPolicy) !== parsed.data.savedPolicyHash) throw unavailable();
    return { id, prior: parsed.data };
  }

  async operation(operationKey: string) {
    const owner = await this.conversations.current(), { prior } = await this.original(this.db, owner, operationKey);
    await this.conversations.same(owner);
    return prior ? { operationKey, status: 'observed' as const, policy: prior.savedPolicy, retryable: false as const }
      : { operationKey, status: 'not_observed' as const, policy: null, retryable: false as const, absence: 'not_proof_of_no_commit' as const };
  }

  async save(value: unknown) {
    const parsed = commandSchema.safeParse(value);
    if (!parsed.success || parsed.data.limits.maxStepMs > parsed.data.limits.maxTotalMs
      || parsed.data.limits.maxTotalMs > leaseMs || parsed.data.limits.maxOutputBytes < 2048)
      throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = parsed.data, owner = await this.conversations.current(), commandHash = hash(command);
    return this.conversations.mutate(owner, async (tx, mark) => {
      const { id, prior } = await this.original(tx, owner, command.operationKey);
      if (prior) {
        if (prior.commandHash !== commandHash) throw conflict();
        return { operationKey: command.operationKey, status: 'observed' as const, policy: prior.savedPolicy, retryable: false as const };
      }
      const deadline = new Date(command.expiresAt), now = this.clock();
      if (deadline <= now || deadline.getTime() - now.getTime() > retentionMs) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const where = policyKey(owner.scopeId);
      // The tenant's principal lock is already held; this scope and policy
      // follow it in the same order as the original configuration producer.
      await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_scopes WHERE id = ${where.scopeId} FOR UPDATE`);
      await tx.$queryRaw(prismaRuntime.sql`SELECT revision FROM ai_task_plan_policies WHERE scopeId = ${where.scopeId}
        AND sceneCode = ${where.sceneCode} AND sceneVersion = ${where.sceneVersion} FOR UPDATE`);
      const old = await policyRow(tx, owner.scopeId);
      if ((old?.revision ?? null) !== command.expectedRevision || (old?.revision ?? 0) >= 4294967294) throw conflict();
      const next = { revision: (old?.revision ?? 0) + 1, enabled: command.enabled, expiresAt: deadline,
        limits: command.limits, allowedTools: tools };
      mark();
      if (old) {
        if ((await tx.aiTaskPlanPolicy.updateMany({ where: { ...where, revision: old.revision }, data: next })).count !== 1) throw conflict();
      } else await tx.aiTaskPlanPolicy.create({ data: { ...where, ...next } });
      const saved = await policyRow(tx, owner.scopeId);
      if (!saved || saved.revision !== next.revision || saved.enabled !== next.enabled || hash(saved.limits) !== hash(next.limits)
        || saved.expiresAt.getTime() !== deadline.getTime() || deadline <= this.clock()) throw unavailable();
      const savedPolicy = projection(saved);
      await tx.operationLog.create({ data: { id, tenantId: owner.tenantId, workspaceId: null, userId: owner.ownerId, action,
        detail: { version: receiptVersion, ...where, operationKey: command.operationKey, expectedRevision: command.expectedRevision,
          commandHash, savedPolicy, savedPolicyHash: hash(savedPolicy), dispatch: 'not_granted' } } });
      return { operationKey: command.operationKey, status: 'observed' as const, policy: savedPolicy, retryable: false as const };
    });
  }
}
