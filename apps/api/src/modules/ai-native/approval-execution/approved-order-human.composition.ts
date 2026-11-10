import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_PROPOSAL_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION,
  type AiApprovalApplicationDecisionDraft, type AiApprovalRecordDraft, type AiProposalDecisionRequestDraft,
  type AiProposalPayloadDraft, type AiProposalRecordDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiApprovalService, AiApprovalRepositoryError, PrismaAiApprovalRepository, type AiApprovalRecord } from '../ai-approval-repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { fingerprintAiProposalDraft } from '../proposal-binding-draft';
import type { ControlledApprovedOrderDependencies } from './controlled-approved-order.composition';
import { ApprovedOrderHumanAuthority } from './approved-order-human.authority';
import { AiApprovedOrderRouteAuthority } from './approved-order-route.authority';
import { PrismaApprovedOrderSnapshotSource } from './prisma-approved-order-snapshot.source';
import { deniedOrder, orderContextHash } from './prisma-approved-order.source';
import { AiTaskRunnerError, callAiTaskRunnerDependency } from '../runner/ai-task-runner.service';
import { approvedOrderReviewMaterial } from './approved-order-review-material';
import { assertQuoteReadAccess } from '../../rental-core/rental-quote-access';
import type { RentalQuoteSnapshotV1 } from '@rental-os/shared';

const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const referenceSchema = z.object({ contractVersion: z.literal(AI_PROPOSAL_DRAFT_VERSION), proposalId: id,
  proposalRevision: z.number().int().min(1).max(4294967294), reviewedPayloadHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
const decisionSchema = referenceSchema.extend({ decision: z.enum(['approve', 'reject']),
  reviewVersion: z.literal(AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION).optional() }).strict() satisfies z.ZodType<AiApprovalApplicationDecisionDraft>;
type Reference = Omit<AiProposalDecisionRequestDraft, 'decision'>;
const money = z.number().finite().nonnegative();
const quoteReviewSchema = z.object({ currency: z.string().min(1).max(16), expiresAt: z.string().datetime({ offset: true }),
  rentalAmount: money, discountAmount: money, couponAmount: money, serviceAmount: money, fulfillmentAmount: money,
  depositAmount: money, preAuthAmount: money, payableAmount: money, receivableAmount: money });
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
export class AiApprovalDecisionResultUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  readonly retryable = false;
  readonly nextAction = 'read_decision_receipt';
  constructor() { super('AI_RESULT_UNKNOWN'); }
}

export function composeApprovedOrderHumanApproval(d: ControlledApprovedOrderDependencies) {
  const human = new ApprovedOrderHumanAuthority(d), clock = d.clock ?? (() => new Date());
  // Current original-material/identity rechecks need a finite native window,
  // not separate 5s slices that abort an otherwise valid human decision. The
  // stopped callback still cannot commit, and uncertainty never permits retry.
  const humanWindowMs = 15000;
  const snapshots = new PrismaApprovedOrderSnapshotSource(d.db, human.policy);
  const route = new AiApprovedOrderRouteAuthority(d.guard, d.credentials, clock);
  const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
    const result = schema.safeParse(value);
    if (!result.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return result.data;
  };
  const load = async (taskId: string, reference: Reference, tx?: Prisma.TransactionClient) => {
    const current = await human.policy.authorizeRead(taskId, tx), db = tx ?? d.db;
    const key = { scopeId: current.scopeId, taskId, proposalId: reference.proposalId };
    const head = await db.aiProposal.findFirst({ where: { scopeId: key.scopeId, taskId, id: key.proposalId } });
    const version = await db.aiProposalVersion.findFirst({ where: { ...key, revision: reference.proposalRevision } });
    if (!head || head.scopeId !== key.scopeId || head.taskId !== taskId || head.id !== key.proposalId
      || !version || Object.entries(key).some(([k, v]) => version[k as keyof typeof version] !== v)
      || version.revision !== reference.proposalRevision || version.payloadHash !== reference.reviewedPayloadHash) throw conflict();
    if (fingerprintAiProposalDraft(version.payload) !== reference.reviewedPayloadHash) throw conflict();
    const payload = structuredClone(version.payload) as unknown as AiProposalPayloadDraft;
    if (payload.taskId !== taskId || payload.proposalId !== reference.proposalId || payload.revision !== reference.proposalRevision
      || payload.audience !== current.context.audience || requestFingerprint(payload.scope) !== requestFingerprint(current.context.scope)
      || payload.atomicity !== 'single_action' || payload.actions.length !== 1 || payload.actions[0].toolCode !== 'rental.order.commit'
      || payload.actions[0].toolVersion !== AI_TOOL_DRAFT_VERSION || !(version.expiresAt instanceof Date)
      || version.expiresAt.getTime() !== Date.parse(payload.expiresAt)) throw conflict();
    if (!['PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'SUPERSEDED'].includes(head.status)
      || (head.status === 'PENDING_CONFIRMATION' ? head.currentRevision !== null
        : ['EXPIRED', 'SUPERSEDED'].includes(head.status) ? head.currentRevision !== null && head.currentRevision !== reference.proposalRevision
          : head.currentRevision !== reference.proposalRevision)
      || await db.aiProposalVersion.findFirst({ where: { ...key, revision: { gt: reference.proposalRevision } } })) throw conflict();
    const facts = await snapshots.read({ ...key, context: current.context, proposalRevision: reference.proposalRevision, action: payload.actions[0] }, tx);
    if (payload.actions[0].target.resourceType !== 'quote' || payload.actions[0].target.resourceId !== facts.input.payload.quoteId
      || payload.actions[0].target.version !== facts.preview.payload.pricingPlanVersion) throw conflict();
    const stable = requestFingerprint({ key, context: orderContextHash(current.context), payload, facts });
    return { ...current, payload, facts, head, stable };
  };
  const publicRecord = (record: AiApprovalRecord, current: Awaited<ReturnType<typeof load>>): AiApprovalRecordDraft => {
    if (current.context.actor.kind !== 'user') throw deniedOrder();
    return { contractVersion: AI_PROPOSAL_DRAFT_VERSION, approvalId: record.approvalId, proposalId: record.proposalId,
      proposalRevision: record.proposalRevision, payloadHash: record.payloadHash, audience: record.audience,
      scope: current.context.scope, actor: current.context.actor, decision: record.decision,
      issuedAt: record.issuedAt.toISOString(), expiresAt: record.expiresAt.toISOString() };
  };
  const same = (first: Awaited<ReturnType<typeof load>>, next: Awaited<ReturnType<typeof load>>, includeHead = true) => {
    if (first.stable !== next.stable || (includeHead && requestFingerprint(first.head) !== requestFingerprint(next.head))) throw conflict();
  };
  const readOriginal = async (taskId: string, value: Reference, verifyMaterial = false, tx?: Prisma.TransactionClient) => {
    taskId = parse(id, taskId);
    const reference = parse(referenceSchema, value), first = await load(taskId, reference, tx);
    return route.withOrderReview(first.context, first.facts.input.payload, async () => {
      same(first, await load(taskId, reference, tx));
      if (verifyMaterial) assertQuoteReadAccess(first.facts.preview.payload as unknown as RentalQuoteSnapshotV1);
      const proposal: AiProposalRecordDraft = { payload: first.payload, payloadHash: reference.reviewedPayloadHash,
        status: first.head.status.toLowerCase() as AiProposalRecordDraft['status'] };
      const { currency, expiresAt: quoteExpiresAt, ...quoteAmounts } = quoteReviewSchema.parse(first.facts.preview.payload);
      return { proposal, facts: first.facts, deterministic: { target: first.payload.actions[0].target,
        quoteAmounts, currency, quoteExpiresAt, decisionExpiresAt: first.payload.expiresAt }, generatedText: null };
    });
  };
  const readProposal = async (taskId: string, value: Reference) => {
    const view = await readOriginal(taskId, value, true);
    return { ...view, deterministic: { ...view.deterministic,
      order: approvedOrderReviewMaterial(view.facts.input.payload, view.facts.preview.payload) } };
  };
  const readReceipt = async (taskId: string, value: AiApprovalApplicationDecisionDraft, tx?: Prisma.TransactionClient) => {
    taskId = parse(id, taskId);
    const command = parse(decisionSchema, value), { decision, reviewVersion, ...reference } = command;
    const first = await load(taskId, reference, tx);
    const read = async () => {
      if (first.context.actor.kind !== 'user') throw deniedOrder();
      const key = { scopeId: first.scopeId, taskId, proposalId: reference.proposalId, proposalRevision: reference.proposalRevision,
        actorKind: 'USER' as const, actorId: first.context.actor.userId };
      const row = await (tx ?? d.db).aiApproval.findFirst({ where: key });
      if (!row) {
        if (first.head.status !== 'PENDING_CONFIRMATION') return { kind: 'unknown' as const,
          retryable: false as const, nextAction: 'read_decision_receipt' as const };
        return { kind: 'absent' as const, retryable: false as const };
      }
      const expected = decision === 'approve' ? 'APPROVED' : 'REJECTED';
      if (Object.entries(key).some(([k, v]) => row[k as keyof typeof row] !== v)
        || row.payloadHash !== reference.reviewedPayloadHash || row.decision !== expected
        || row.audience !== first.context.audience.toUpperCase()
        || ![(decision === 'approve' ? 'CONFIRMED' : 'CANCELLED'), 'EXPIRED', 'SUPERSEDED'].includes(first.head.status)
        || !(row.issuedAt instanceof Date) || !(row.expiresAt instanceof Date) || !Number.isFinite(row.issuedAt.getTime())
        || row.issuedAt > clock() || row.issuedAt >= row.expiresAt || row.expiresAt.getTime() !== Date.parse(first.payload.expiresAt)) throw conflict();
      const record: AiApprovalRecord = { ...key, approvalId: row.id, payloadHash: row.payloadHash, actorKind: 'user',
        audience: first.context.audience as AiApprovalRecord['audience'], decision: decision === 'approve' ? 'approved' : 'rejected',
        issuedAt: row.issuedAt, expiresAt: row.expiresAt };
      return { kind: 'recorded' as const, record: publicRecord(record, first) };
    };
    return route.withOrderReview(first.context, first.facts.input.payload, async () => {
      const before = await read();
      same(first, await load(taskId, reference, tx));
      const after = await read();
      if (requestFingerprint(before) !== requestFingerprint(after)) return { kind: 'unknown' as const,
        retryable: false as const, nextAction: 'read_decision_receipt' as const };
      return after;
    });
  };
  const decide = async (taskId: string, value: AiApprovalApplicationDecisionDraft) => {
    let started = false, committed = false;
    const attempt = async (signal: AbortSignal) => {
      const assertActive = () => { if (signal.aborted) throw new AiApprovalDecisionResultUnknownError(); };
      taskId = parse(id, taskId);
      const command = parse(decisionSchema, value), { decision, reviewVersion, ...reference } = command;
      const first = await load(taskId, reference), grant = await human.resolve(taskId);
      if (decision === 'approve' && first.head.status === 'PENDING_CONFIRMATION'
        && reviewVersion !== AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      assertActive();
      if (orderContextHash(first.context) !== orderContextHash(grant.context)) throw deniedOrder();
      const recheck = async (tx?: Prisma.TransactionClient) => {
        assertActive();
        const original = await load(taskId, reference, tx);
        same(first, original, false);
        // Legacy receipts need no new material; a new approval cannot omit the
        // customer, rental and fulfillment facts this human host must show.
        if (decision === 'approve' && first.head.status === 'PENDING_CONFIRMATION')
          approvedOrderReviewMaterial(original.facts.input.payload, original.facts.preview.payload);
        const current = await human.resolve(taskId, tx);
        assertActive();
        if (current.bindingHash !== grant.bindingHash || Date.parse(first.payload.expiresAt) <= clock().getTime()) throw deniedOrder();
      };
      await recheck();
      const service = new AiApprovalService({ decide: async (input, principal) => {
        // A late preflight cannot begin a decision. During the transaction the
        // final recheck rolls back stopped work; a lost COMMIT reply is still
        // unknown and must be observed by the original decision reference.
        assertActive();
        started = true;
        const record = await d.db.$transaction(async tx => {
          await recheck(tx);
          // Reuse the existing decision/CAS repository inside this authorization-checked transaction.
          const db = { aiProposal: tx.aiProposal, aiProposalVersion: tx.aiProposalVersion, aiApproval: tx.aiApproval,
            $transaction: (work: (client: Prisma.TransactionClient) => Promise<AiApprovalRecord>) => work(tx)
          } as unknown as ConstructorParameters<typeof PrismaAiApprovalRepository>[0];
          const record = await new PrismaAiApprovalRepository(db, clock).decide(input, principal);
          await recheck(tx);
          return record;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: humanWindowMs });
        committed = true;
        return record;
      } }, { authorize: async (context, input) => {
        if (orderContextHash(context) !== orderContextHash(grant.context) || input.scopeId !== grant.principal.scopeId
          || input.taskId !== taskId || input.proposalId !== command.proposalId || input.proposalRevision !== command.proposalRevision
          || input.reviewedPayloadHash !== reference.reviewedPayloadHash || requestFingerprint(input.payload) !== requestFingerprint(first.payload)
          || input.decision !== (decision === 'approve' ? 'approved' : 'rejected')) throw deniedOrder();
        await recheck();
        return grant.principal;
      } });
      const outcome = await route.withOrderPreparation(grant.context, first.facts.input.payload, async () => {
        try {
          if (decision === 'approve' && first.head.status === 'PENDING_CONFIRMATION')
            assertQuoteReadAccess(first.facts.preview.payload as unknown as RentalQuoteSnapshotV1);
          const record = await service.decide({ context: grant.context, scopeId: grant.principal.scopeId, taskId,
            proposalId: reference.proposalId, proposalRevision: reference.proposalRevision, payload: first.payload,
            reviewedPayloadHash: reference.reviewedPayloadHash, decision: decision === 'approve' ? 'approved' : 'rejected' });
          await recheck();
          return { ok: true as const, record: publicRecord(record, first) };
        } catch (error) { return { ok: false as const, error }; }
      });
      if (!outcome.ok) throw outcome.error;
      return outcome.record;
    };
    try {
      return await callAiTaskRunnerDependency(attempt, humanWindowMs, 'approval_decision', undefined, d.runnerClock);
    } catch (error) {
      if (committed && !(error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED')) {
        throw new AiApprovalDecisionResultUnknownError();
      }
      if (error instanceof AiTaskRepositoryError) throw error;
      if (error instanceof AiApprovalRepositoryError && error.code !== 'UNAVAILABLE') {
        throw new AiTaskRepositoryError(error.code === 'INVALID' ? 'AI_INVALID_INPUT' : error.code === 'CONFLICT' ? 'AI_REVISION_CONFLICT' : 'AI_ACCESS_DENIED');
      }
      if (started) throw new AiApprovalDecisionResultUnknownError();
      throw unavailable();
    }
  };
  // Observing a historical decision never creates one. Bound the complete
  // observation, including current ACL and route revalidation, independently.
  const observe = async <T>(operation: () => Promise<T>) => {
    try { return await callAiTaskRunnerDependency(operation, humanWindowMs, 'approval_observation', undefined, d.runnerClock); }
    catch (error) {
      if (error instanceof AiTaskRunnerError && ['AI_RUN_LIMIT', 'AI_RESULT_UNKNOWN'].includes(error.code)) throw unavailable();
      throw error;
    }
  };
  return Object.freeze({
    // Internal historical observation preserves legacy evidence; public hosts
    // use readProposal and cannot promote an incomplete snapshot to approval.
    // Transition-local observation must see that transaction's task/proposal
    // rows. The transaction is server-supplied; current credential/Guard checks
    // remain independent, and no HTTP body can select a database reader.
    readOriginal: (taskId: string, value: Reference, tx?: Prisma.TransactionClient) => observe(() => readOriginal(taskId, structuredClone(value), false, tx)),
    readProposal: (taskId: string, value: Reference) => observe(() => readProposal(taskId, structuredClone(value))),
    decide,
    readReceipt: (taskId: string, value: AiApprovalApplicationDecisionDraft, tx?: Prisma.TransactionClient) => observe(() => readReceipt(taskId, structuredClone(value), tx))
  });
}
