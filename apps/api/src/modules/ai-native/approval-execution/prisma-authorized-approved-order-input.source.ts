import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { ApprovedOrderInputAuthority } from '../order-task-input.ports';
import { isAiStepExecutionContext } from '../task-contract-validation';
import type { ApprovedOrderExecutionInputSource, ApprovedOrderOriginalInputSource } from './approved-order-composition.ports';
import { deniedOrder, orderContextHash } from './prisma-approved-order.source';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const referenceSchema = z.object({ scopeId: id.max(36), taskId: id.max(36), runId: id.max(36), stepId: id.max(36),
  actionId: id, inputRef: id.max(36), registrationRef: id, fingerprint: hash }).strict();
const proofSchema = z.object({ context: z.unknown(), reference: referenceSchema, toolCode: z.literal('rental.order.commit'),
  toolVersion: id, policyRevision: z.number().int().positive().max(4294967294), policyHash: hash, bindingHash: hash,
  expiresAt: z.string().datetime({ offset: true }) }).strict();

/** Formal proof adapter shared by preparation and uncommitted Core execution.
 * References come from transaction-local rows, never from a model or a quote.
 */
export class PrismaAuthorizedApprovedOrderInputSource implements ApprovedOrderExecutionInputSource {
  constructor(private readonly authority: ApprovedOrderInputAuthority, private readonly reader: ApprovedOrderOriginalInputSource,
    private readonly toolVersion: string, private readonly clock: () => Date = () => new Date()) {
    if (typeof authority?.authorizeOrderInput !== 'function' || typeof reader?.read !== 'function'
      || !id.safeParse(toolVersion).success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }

  async readAuthorized(presented: Parameters<ApprovedOrderOriginalInputSource['read']>[0], tx: Prisma.TransactionClient) {
    try {
      const input = structuredClone(presented);
      if (!isAiStepExecutionContext(input.context)) throw deniedOrder();
      const key = { scopeId: input.scopeId, taskId: input.taskId, runId: input.runId, actionId: input.actionId };
      const read = async () => {
        const step = await tx.aiStep.findFirst({ where: key });
        if (!step?.inputRef || step.status !== 'RUNNING' || step.toolCode !== 'rental.order.commit'
          || step.toolVersion !== this.toolVersion || Object.entries(key).some(([k, v]) => step[k as keyof typeof step] !== v)) throw deniedOrder();
        const row = await tx.aiTaskActionInput.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId, id: step.inputRef } });
        if (!row || row.id !== step.inputRef || row.scopeId !== key.scopeId || row.taskId !== key.taskId || row.runId !== key.runId
          || row.toolCode !== step.toolCode || row.toolVersion !== step.toolVersion || row.fingerprint !== step.requestFingerprint
          || requestFingerprint(row.payload) !== row.fingerprint) throw deniedOrder();
        const reference = referenceSchema.parse({ ...key, stepId: step.id, inputRef: step.inputRef,
          registrationRef: row.registrationRef, fingerprint: row.fingerprint });
        return { reference, row, binding: requestFingerprint({ reference, revision: step.revision, row }) };
      };
      const original = await read();
      const authorize = async () => {
        const proof = proofSchema.parse(structuredClone(await this.authority.authorizeOrderInput(original.reference, tx)));
        const now = this.clock();
        if (!isAiStepExecutionContext(proof.context) || orderContextHash(proof.context) !== orderContextHash(input.context)
          || requestFingerprint(proof.reference) !== requestFingerprint(original.reference) || proof.toolVersion !== this.toolVersion
          || proof.policyRevision !== original.row.policyRevision || !(now instanceof Date) || !Number.isFinite(now.getTime())
          || !(original.row.expiresAt instanceof Date) || !Number.isFinite(original.row.expiresAt.getTime())
          || Date.parse(proof.expiresAt) <= now.getTime() || Date.parse(proof.expiresAt) > original.row.expiresAt.getTime()) throw deniedOrder();
        return requestFingerprint({ ...proof, context: orderContextHash(proof.context) });
      };
      const bindingHash = await authorize();
      const body = await this.reader.read(input, tx);
      const latest = await read();
      if (!body || requestFingerprint(body) !== original.reference.fingerprint || latest.binding !== original.binding
        || await authorize() !== bindingHash) throw deniedOrder();
      return { body: structuredClone(body), bindingHash };
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw new AiTaskRepositoryError(error.code);
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
  }

  async read(reference: Parameters<ApprovedOrderOriginalInputSource['read']>[0], tx: Prisma.TransactionClient) {
    return (await this.readAuthorized(reference, tx)).body;
  }
}
