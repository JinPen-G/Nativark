import { ValidationPipe } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { CreateRentalOrderDto } from '../../rental-core/rental-order-request.dto';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { fingerprintAiProposalDraft } from '../proposal-binding-draft';
import type { ApprovedOrderSnapshotSource } from './approved-order-composition.ports';
import type { PersistedApprovedOrderPolicyAuthority } from './persisted-approved-order-policy.authority';
import { deniedOrder, orderContextHash } from './prisma-approved-order.source';

export const approvedOrderPreviewSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), pricingPlanVersion: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  consumedAt: z.string().datetime({ offset: true }).optional(), consumedOrderId: z.string().min(1).optional()
}).passthrough();

function jsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const result: Record<string, Prisma.InputJsonValue | null> = Object.create(null);
    for (const [key, entry] of Object.entries(value)) if (entry !== undefined) result[key] = jsonValue(entry);
    return result;
  }
  throw deniedOrder();
}
export function approvedOrderSnapshotJson(value: unknown) {
  const json = jsonValue(structuredClone(value));
  if (json === null || requestFingerprint(value) !== requestFingerprint(json)) throw deniedOrder();
  return json;
}

type Db = Pick<PrismaClient, 'aiApprovedOrderSnapshot' | 'aiProposalVersion'>;
export class PrismaApprovedOrderSnapshotSource implements ApprovedOrderSnapshotSource {
  private readonly validation = new ValidationPipe({ transform: true, whitelist: true });
  constructor(private readonly db: Db, private readonly policy: Pick<PersistedApprovedOrderPolicyAuthority, 'authorizeRead'>) {
    if (typeof db?.aiApprovedOrderSnapshot?.findFirst !== 'function' || typeof db?.aiProposalVersion?.findFirst !== 'function'
      || typeof policy?.authorizeRead !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }

  async read(request: Parameters<ApprovedOrderSnapshotSource['read']>[0], tx?: Prisma.TransactionClient) {
    try {
      request = structuredClone(request);
      const first = await this.policy.authorizeRead(request.taskId, tx), db = tx ?? this.db;
      if (first.scopeId !== request.scopeId || orderContextHash(first.context) !== orderContextHash(request.context)
        || first.context.actor.kind !== 'user') throw deniedOrder();
      const versionKey = { scopeId: request.scopeId, taskId: request.taskId, proposalId: request.proposalId, revision: request.proposalRevision };
      const version = await db.aiProposalVersion.findFirst({ where: versionKey });
      if (!version || Object.entries(versionKey).some(([key, value]) => version[key as keyof typeof version] !== value)
        || fingerprintAiProposalDraft(version.payload) !== version.payloadHash) throw deniedOrder();
      const payload = version.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.actions)
        || payload.taskId !== request.taskId || payload.proposalId !== request.proposalId || payload.revision !== request.proposalRevision
        || payload.audience !== first.context.audience || requestFingerprint(payload.scope) !== requestFingerprint(first.context.scope)
        || payload.atomicity !== 'single_action' || payload.actions.length !== 1
        || requestFingerprint(payload.actions[0]) !== requestFingerprint(request.action)) throw deniedOrder();
      const base = { scopeId: request.scopeId, taskId: request.taskId, proposalId: request.proposalId,
        proposalRevision: request.proposalRevision, actionId: request.action.actionId, actionFingerprint: request.action.input.contentHash };
      const read = async (kind: 'INPUT' | 'PREVIEW') => {
        const ref = request.action[kind === 'INPUT' ? 'input' : 'preview'];
        const key = { ...base, kind, recordId: ref.recordId, revision: ref.revision, contentHash: ref.contentHash };
        const row = await db.aiApprovedOrderSnapshot.findFirst({ where: key });
        if (!row || Object.entries(key).some(([name, value]) => row[name as keyof typeof row] !== value)
          || row.actorKind !== 'USER' || first.context.actor.kind !== 'user' || row.actorId !== first.context.actor.userId
          || row.audience !== first.context.audience.toUpperCase()
          || requestFingerprint(row.payload) !== ref.contentHash) throw deniedOrder();
        return row;
      };
      const input = await read('INPUT'), preview = await read('PREVIEW');
      const body: CreateRentalOrderDto = await this.validation.transform(input.payload, { type: 'body', metatype: CreateRentalOrderDto });
      const quote = approvedOrderPreviewSchema.parse(preview.payload);
      if (body.capabilityExceptions !== undefined || requestFingerprint(body) !== input.contentHash
        || requestFingerprint(quote) !== preview.contentHash || body.quoteId !== quote.id
        || first.context.scope.kind !== 'workspace' || quote.tenantId !== first.context.scope.tenantId
        || quote.consumedAt || quote.consumedOrderId) throw deniedOrder();
      const current = await this.policy.authorizeRead(request.taskId, tx);
      if (current.scopeId !== first.scopeId || orderContextHash(first.context) !== orderContextHash(current.context)) throw deniedOrder();
      const envelope = { scopeId: base.scopeId, taskId: base.taskId, actionId: base.actionId };
      return { input: { ...envelope, ...request.action.input, payload: structuredClone(body) },
        preview: { ...envelope, ...request.action.preview, payload: structuredClone(quote) } };
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw new AiTaskRepositoryError(error.code);
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
  }
}
