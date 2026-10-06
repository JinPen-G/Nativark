import { ValidationPipe } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CreateRentalOrderDto } from '../../rental-core/rental-order-request.dto';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { ApprovedOrderOriginalInputSource } from './approved-order-composition.ports';
import type { PersistedApprovedOrderPolicyAuthority } from './persisted-approved-order-policy.authority';
import { approvedOrderSnapshotJson } from './prisma-approved-order-snapshot.source';
import { deniedOrder, orderContextHash } from './prisma-approved-order.source';

const id = z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const referenceSchema = z.object({ scopeId: id.max(36), taskId: id.max(36), runId: id.max(36),
  actionId: id.max(191) }).strict();

/** Read-only adapter. It neither produces order inputs nor authorizes a write plan.
 * A server-side producer and registered step must already exist; absent facts fail closed.
 * Preparation owns the enclosing transaction and live lease lock.
 */
export class PrismaApprovedOrderOriginalInputSource implements ApprovedOrderOriginalInputSource {
  private readonly validation = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  constructor(private readonly policy: Pick<PersistedApprovedOrderPolicyAuthority, 'authorizePreparation'>,
    private readonly toolVersion: string, private readonly clock: () => Date = () => new Date()) {
    if (typeof policy?.authorizePreparation !== 'function' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(toolVersion)) {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
  }

  async read(presented: Parameters<ApprovedOrderOriginalInputSource['read']>[0], tx: Prisma.TransactionClient) {
    try {
      const { context, ...raw } = structuredClone(presented), reference = referenceSchema.parse(raw);
      if (typeof tx?.aiTaskActionInput?.findFirst !== 'function' || typeof tx.aiStep?.findFirst !== 'function') {
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      }
      const first = await this.policy.authorizePreparation(reference.taskId, tx);
      if (first.scopeId !== reference.scopeId || orderContextHash(first.context) !== orderContextHash(context)) throw deniedOrder();
      const key = { ...reference, toolCode: 'rental.order.commit', toolVersion: this.toolVersion, status: 'RUNNING' as const };
      const read = async () => {
        const step = await tx.aiStep.findFirst({ where: key });
        if (!step || Object.entries(key).some(([name, value]) => step[name as keyof typeof step] !== value)
          || !id.max(36).safeParse(step.inputRef).success) throw deniedOrder();
        const inputKey = { scopeId: reference.scopeId, taskId: reference.taskId, runId: reference.runId, id: step.inputRef! };
        const row = await tx.aiTaskActionInput.findFirst({ where: inputKey });
        const now = this.clock();
        if (!row || Object.entries(inputKey).some(([name, value]) => row[name as keyof typeof row] !== value)
          || row.toolCode !== key.toolCode || row.toolVersion !== key.toolVersion
          || !Number.isInteger(row.policyRevision) || row.policyRevision < 1
          || !row.registrationRef || row.registrationRef.length > 191
          || !(now instanceof Date) || !Number.isFinite(now.getTime())
          || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()) || row.expiresAt <= now
          || !/^[a-f0-9]{64}$/u.test(row.fingerprint) || row.fingerprint !== step.requestFingerprint
          || requestFingerprint(row.payload) !== row.fingerprint) throw deniedOrder();
        const body: CreateRentalOrderDto = await this.validation.transform(structuredClone(row.payload), { type: 'body', metatype: CreateRentalOrderDto });
        if (body.capabilityExceptions !== undefined || requestFingerprint(body) !== row.fingerprint) throw deniedOrder();
        // DTO instances materialize absent optional properties as undefined. Return the
        // same validated JSON bytes, not those transient class-transformer properties.
        const normalized: CreateRentalOrderDto = JSON.parse(JSON.stringify(approvedOrderSnapshotJson(body)));
        return { body: normalized, binding: requestFingerprint({ step, row }) };
      };
      const original = await read();
      const current = await this.policy.authorizePreparation(reference.taskId, tx);
      if (current.scopeId !== first.scopeId || orderContextHash(first.context) !== orderContextHash(current.context)) throw deniedOrder();
      const latest = await read();
      if (latest.binding !== original.binding) throw deniedOrder();
      // The JSON has passed the real Core DTO validator without adding, dropping or coercing fields.
      return structuredClone(latest.body);
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw new AiTaskRepositoryError(error.code);
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
  }
}
