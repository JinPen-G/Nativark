import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_PROPOSAL_DRAFT_VERSION } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiTaskConfirmationCheckpointSource } from '../ai-task-transition.repository';
import type { composeControlledApprovedOrder } from '../approval-execution/controlled-approved-order.composition';
import { aiTaskRunPlanSchema, type AiTaskPlanEvidenceAuthority, type AiConfirmationTool } from './prisma-task-run-evidence.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), shortId = id.max(36);
const hash = z.string().regex(/^[a-f0-9]{64}$/u), revision = z.number().int().min(1).max(4294967294);
const token = z.string().regex(/^[1-9][0-9]{0,19}$/u);
const leaseSchema = z.object({ taskId: shortId, runId: shortId, holderId: id, revision, fencingToken: token,
  expiresAt: z.string().datetime({ offset: true }) }).strict();
const bindingSchema = z.object({ scopeId: shortId, taskId: shortId, runId: shortId, stepId: shortId,
  actionId: id, inputRef: shortId, fingerprint: hash }).strict();
const proposalSchema = z.object({ contractVersion: z.literal(AI_PROPOSAL_DRAFT_VERSION), proposalId: shortId,
  proposalRevision: revision, reviewedPayloadHash: hash }).strict();
export const waitingPayloadSchema = z.object({ version: z.enum(['approved-order-wait-1', 'approved-settings-wait-1']), binding: bindingSchema,
  presentedLease: leaseSchema, effectState: z.literal('awaiting_decision'), proposal: proposalSchema }).strict();
const startSchema = z.object({ scopeId: shortId, taskId: shortId, id: shortId, runId: shortId, stepId: shortId,
  originalArtifactId: shortId, inputRef: shortId, stepsChargeId: shortId, activeMsChargeId: shortId, outputBytesChargeId: shortId,
  actionId: id, leaseOwnerId: id, stepFingerprint: hash, planHash: hash,
  fencingToken: z.instanceof(Prisma.Decimal).refine(v => v.isInteger() && v.gt(0) && v.lte('99999999999999999999')).transform(v => v.toFixed(0)),
  runRevision: revision, stepRevision: revision, sequence: z.literal(1), previousReceiptId: z.null(), decisionRef: z.null(),
  createdAt: z.date() }).strict();
const receiptSchema = z.object({ scopeId: shortId, taskId: shortId, id: shortId, runId: shortId, stepId: shortId, phaseId: shortId,
  kind: z.literal('confirmation'), errorCode: z.null(), payload: waitingPayloadSchema, contentHash: hash,
  activeMs: z.bigint().min(0n).max(86400000n), outputBytes: z.bigint().min(0n).max(16777216n),
  proposalId: shortId, proposalRevision: revision, reviewedPayloadHash: hash, decisionRef: z.null(), businessResultRef: z.null(), createdAt: z.date() }).strict();
const inputSchema = z.object({ scopeId: shortId, taskId: shortId, runId: shortId, stepId: shortId, checkpointRef: shortId, lease: leaseSchema }).strict();
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
type WaitingRead = ReturnType<typeof composeControlledApprovedOrder>['waiting']['readWaiting'];
type Waiting = { readWaiting(input: Parameters<WaitingRead>[0], tx?: Prisma.TransactionClient): ReturnType<WaitingRead> };

function phaseReader(tx: Prisma.TransactionClient, name: 'aiTaskExecutionPhaseStart' | 'aiTaskExecutionPhaseReceipt') {
  const delegate: unknown = (tx as unknown as Record<string, unknown>)[name];
  if (!delegate || typeof delegate !== 'object' || !('findFirst' in delegate) || typeof delegate.findFirst !== 'function') throw unavailable();
  return delegate.findFirst.bind(delegate) as (args: { where: Record<string, string> }) => Promise<unknown>;
}

export class PrismaTaskConfirmationCheckpointSource implements AiTaskConfirmationCheckpointSource {
  constructor(private readonly waiting: Waiting, private readonly plans: AiTaskPlanEvidenceAuthority,
    private readonly clock: () => Date = () => new Date(),
    private readonly confirmationTool: AiConfirmationTool = 'rental.order.commit') {
    if (typeof waiting?.readWaiting !== 'function' || typeof plans?.authorize !== 'function'
        || !['rental.order.commit', 'tenant.notifications.commit'].includes(confirmationTool)) throw unavailable();
  }

  async read(value: Parameters<AiTaskConfirmationCheckpointSource['read']>[0], tx: Prisma.TransactionClient) {
    return (await this.readPhase(value, tx, false)).proof;
  }

  async readDecision(value: Parameters<AiTaskConfirmationCheckpointSource['read']>[0], tx: Prisma.TransactionClient) {
    const result = await this.readPhase(value, tx, true);
    if (!result.decision || result.remainingActiveMs <= 0 || result.remainingOutputBytes <= 0) throw unavailable();
    return { ...result.proof, decisionRef: result.decision.approvalId, decision: result.decision.decision,
      remainingActiveMs: result.remainingActiveMs, remainingOutputBytes: result.remainingOutputBytes };
  }

  private async readPhase(value: Parameters<AiTaskConfirmationCheckpointSource['read']>[0], tx: Prisma.TransactionClient, continuation: boolean) {
    const input = inputSchema.parse(structuredClone(value));
    if (input.taskId !== input.lease.taskId || input.runId !== input.lease.runId) throw denied();
    const { scopeId, taskId, runId, stepId } = input, key = { scopeId, taskId, runId, stepId };
    const rawReceipt = await phaseReader(tx, 'aiTaskExecutionPhaseReceipt')({ where: { ...key, id: input.checkpointRef } });
    if (!rawReceipt) throw unavailable();
    const receipt = receiptSchema.parse(rawReceipt);
    const rawStart = await phaseReader(tx, 'aiTaskExecutionPhaseStart')({ where: { ...key, id: receipt.phaseId } });
    if (!rawStart) throw unavailable();
    const start = startSchema.parse(rawStart), payload = receipt.payload;
    if (payload.version !== (this.confirmationTool === 'rental.order.commit' ? 'approved-order-wait-1' : 'approved-settings-wait-1')) throw denied();
    const boundStep = await tx.aiStep.findFirst({ where: { scopeId, taskId, runId, id: stepId } });
    if (!boundStep || boundStep.toolCode !== this.confirmationTool) throw denied();
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || start.createdAt > receipt.createdAt || receipt.createdAt > now
      || Object.entries(key).some(([k, v]) => start[k as keyof typeof start] !== v || receipt[k as keyof typeof receipt] !== v)
      || receipt.id !== input.checkpointRef || start.id !== receipt.phaseId
      || (!continuation && (start.leaseOwnerId !== input.lease.holderId || start.fencingToken !== input.lease.fencingToken || start.runRevision !== input.lease.revision))
      || (continuation && (BigInt(start.fencingToken) > BigInt(input.lease.fencingToken) || start.runRevision > input.lease.revision
        || (start.fencingToken === input.lease.fencingToken && start.leaseOwnerId !== input.lease.holderId)))
      || Date.parse(input.lease.expiresAt) <= now.getTime() || requestFingerprint(payload) !== receipt.contentHash
      || BigInt(Buffer.byteLength(JSON.stringify(payload), 'utf8')) !== receipt.outputBytes
      || payload.presentedLease.taskId !== taskId || payload.presentedLease.runId !== runId
      || payload.presentedLease.holderId !== start.leaseOwnerId || payload.presentedLease.fencingToken !== start.fencingToken
      || payload.presentedLease.revision !== start.runRevision
      || (!continuation && requestFingerprint(payload.presentedLease) !== requestFingerprint(input.lease))
      || requestFingerprint(payload.binding) !== requestFingerprint({ ...key, actionId: start.actionId, inputRef: start.inputRef, fingerprint: start.stepFingerprint })
      || payload.proposal.proposalId !== receipt.proposalId || payload.proposal.proposalRevision !== receipt.proposalRevision
      || payload.proposal.reviewedPayloadHash !== receipt.reviewedPayloadHash) throw denied();
    const original = await tx.aiTaskResultArtifact.findFirst({ where: { ...key, id: start.originalArtifactId } });
    if (!original || original.id !== start.originalArtifactId || Object.entries(key).some(([k, v]) => original[k as keyof typeof original] !== v)
      || original.actionId !== start.actionId || original.stepFingerprint !== start.stepFingerprint
      || original.leaseOwnerId !== start.leaseOwnerId || original.fencingToken.toFixed(0) !== start.fencingToken
      || original.outcome !== 'RUNNING' || original.completeMeasurement || original.activeMs !== 0n || original.outputBytes !== 0n
      || original.contentHash !== requestFingerprint({}) || requestFingerprint(original.payload) !== original.contentHash) throw denied();
    const chargeIds = [start.stepsChargeId, start.activeMsChargeId, start.outputBytesChargeId];
    const charges = await tx.aiTaskExecutionCharge.findMany({ where: { ...key, actionId: start.actionId, stepFingerprint: start.stepFingerprint }, take: 5 });
    const expected = { STEPS: start.stepsChargeId, ACTIVE_MS: start.activeMsChargeId, OUTPUT_BYTES: start.outputBytesChargeId };
    if (new Set(chargeIds).size !== 3 || charges.length !== 3 || new Set(charges.map(c => c.resource)).size !== 3
      || charges.some(c => Object.entries(key).some(([k, v]) => c[k as keyof typeof c] !== v)
        || c.actionId !== start.actionId || c.stepFingerprint !== start.stepFingerprint || c.status !== 'RESERVED'
        || c.gatewayInvocationId !== null || c.leaseOwnerId !== start.leaseOwnerId || c.fencingToken.toFixed(0) !== start.fencingToken
        || !(c.resource in expected) || expected[c.resource as keyof typeof expected] !== c.chargeId
        || c.amount < (c.resource === 'ACTIVE_MS' ? receipt.activeMs : c.resource === 'OUTPUT_BYTES' ? receipt.outputBytes : 1n))) throw denied();
    if (continuation && await phaseReader(tx, 'aiTaskExecutionPhaseStart')({ where: { ...key, previousReceiptId: receipt.id } })) throw denied();
    const saved = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { scopeId, taskId, runId } } });
    if (!saved || saved.scopeId !== scopeId || saved.taskId !== taskId || saved.runId !== runId || saved.planHash !== start.planHash
      || requestFingerprint(saved.payload) !== saved.planHash) throw denied();
    const plan = aiTaskRunPlanSchema.parse(saved.payload);
    if (plan.taskId !== taskId || plan.runId !== runId || receipt.activeMs > BigInt(plan.limits.maxStepMs)
      || receipt.outputBytes > BigInt(plan.limits.maxOutputBytes)) throw denied();
    const authorize = async () => {
      // Pausing records the already-persisted phase under the transition's
      // current owner/lease checks. It grants no further execution. Only
      // resuming a human decision requires today's live plan authority.
      if (!continuation) {
        if (!hash.safeParse(saved.authorityHash).success || !id.max(64).safeParse(saved.policyVersion).success) throw denied();
        return requestFingerprint({ authorityHash: saved.authorityHash, policyVersion: saved.policyVersion });
      }
      const proof = await this.plans.authorize(structuredClone(plan), structuredClone(input.lease));
      if (proof.authorityHash !== saved.authorityHash || proof.policyVersion !== saved.policyVersion
        || !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= this.clock().getTime()) throw denied();
      return requestFingerprint({ authorityHash: proof.authorityHash, policyVersion: proof.policyVersion });
    };
    const authority = await authorize();
    const waiting = await this.waiting.readWaiting({ taskId, runId, stepId, actionId: start.actionId, inputRef: start.inputRef,
      fingerprint: start.stepFingerprint, lease: structuredClone(input.lease) }, tx);
    if (waiting.kind !== 'waiting_reference' || (continuation ? waiting.receipt.kind !== 'recorded' : waiting.receipt.kind !== 'absent')
      || requestFingerprint(waiting.binding) !== requestFingerprint(payload.binding)
      || requestFingerprint(waiting.proposal) !== requestFingerprint(payload.proposal) || await authorize() !== authority) throw denied();
    const proof = { ...key, checkpointRef: receipt.id, phaseId: start.id, kind: 'confirmation' as const, actionId: start.actionId,
      inputRef: start.inputRef, stepRevision: start.stepRevision, stepFingerprint: start.stepFingerprint, planHash: start.planHash,
      contentHash: receipt.contentHash, leaseOwnerId: start.leaseOwnerId, fencingToken: start.fencingToken, runRevision: start.runRevision,
      proposalId: receipt.proposalId, proposalRevision: receipt.proposalRevision, reviewedPayloadHash: receipt.reviewedPayloadHash };
    return { proof, decision: waiting.receipt.kind === 'recorded' ? waiting.receipt.record : null,
      remainingActiveMs: Math.min(Number(charges.find(c => c.resource === 'ACTIVE_MS')!.amount), plan.limits.maxStepMs) - Number(receipt.activeMs),
      remainingOutputBytes: Math.min(Number(charges.find(c => c.resource === 'OUTPUT_BYTES')!.amount), plan.limits.maxOutputBytes) - Number(receipt.outputBytes) };
  }
}
