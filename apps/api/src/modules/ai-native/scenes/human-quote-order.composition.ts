import { z } from 'zod';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { composeControlledApprovedOrder, type ControlledApprovedOrderDependencies } from '../approval-execution/controlled-approved-order.composition';
import { approvedOrderCommandSchema } from '../approval-execution/prisma-approved-order.source';
import { PrismaQuoteSelectionRepository, type HumanQuoteSelectionDependencies } from '../task-request/prisma-quote-selection.repository';
import { parseQuoteSelectionProof } from '../task-request/quote-selection.validation';
import type { AiTaskRunnerLease } from '../runner/ai-task-runner.ports';
import { freezeOriginalInput } from '../task-request/original-request.validation';

export type HumanQuoteOrderDependencies = ControlledApprovedOrderDependencies &
  Pick<HumanQuoteSelectionDependencies, 'originals'>;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const publication = z.object({ selection: z.unknown(), expectedTaskRevision: revision,
  lease: z.object({ taskId: id.max(36), runId: id.max(36), holderId: id, revision,
    fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u), expiresAt: z.string().max(40) }).strict() }).strict();
const preparation = z.object({ selection: z.unknown(), command: approvedOrderCommandSchema
  .omit({ approvalId: true, reviewedPayloadHash: true })
  .extend({ expiresAt: z.string().datetime({ offset: true }) }).strict() }).strict();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

/** Server-only application. A choice is immutable material, NOT approval or a
 * lease. The original runner must acquire/start the run and the original AIN07
 * preparation must verify its running step. No worker or HTTP route is installed.
 * Metadata publication and proposal preparation are separate transactions;
 * post-check failure can leave metadata/pending proposal, never an approved order.
 */
export function composeHumanQuoteOrder(dependencies: HumanQuoteOrderDependencies) {
  const selections = new PrismaQuoteSelectionRepository(dependencies);
  const controlled = composeControlledApprovedOrder(dependencies);
  const registrationRef = (selectionId: string) => `quote-selection:${selectionId}`;
  const fresh = async (reference: unknown, bindingHash: string) => {
    const current = await selections.readAuthorized(reference);
    if (current.bindingHash !== bindingHash) throw denied();
    return current;
  };
  return Object.freeze({
    select: selections.select.bind(selections), read: selections.read.bind(selections),
    reconcile: selections.reconcile.bind(selections),
    /** Internal runner host only. Body and registration key derive from the
     * current persisted human choice, not a caller's proposed order body. */
    async publishSelectedInput(value: unknown) {
      const parsed = publication.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = parsed.data, ref = parseQuoteSelectionProof(command.selection);
      const proof = await selections.readAuthorized(ref);
      if (command.lease.taskId !== proof.taskId || command.lease.runId !== proof.runId) throw denied();
      const input = await controlled.source.publishOrderInput({ taskId: proof.taskId,
        registrationRef: registrationRef(proof.selectionId), expectedTaskRevision: command.expectedTaskRevision,
        lease: command.lease as AiTaskRunnerLease, input: proof.body });
      await fresh(ref, proof.bindingHash);
      return freezeOriginalInput({ stage: 'original_input_published' as const, inputRef: input.id,
        replayed: input.replayed, registrationRef: registrationRef(proof.selectionId),
        inputHash: proof.inputHash, selectionId: proof.selectionId,
        approval: 'not_granted' as const, order: 'not_created' as const });
    },
    /** Caller supplies only the existing preparation command, never snapshots
     * or permission. The actual running step must point to this selected input. */
    async prepareSelectedProposal(value: unknown) {
      const parsed = preparation.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const ref = parseQuoteSelectionProof(parsed.data.selection), command = parsed.data.command;
      const proof = await selections.readAuthorized(ref);
      if (command.taskId !== proof.taskId || command.lease.runId !== proof.runId
        || Date.parse(command.expiresAt) > Date.parse(proof.expiresAt)) throw denied();
      const step = await dependencies.db.aiStep.findFirst({ where: { scopeId: proof.scopeId,
        taskId: proof.taskId, runId: proof.runId, actionId: command.actionId } });
      const original = step?.inputRef ? await dependencies.db.aiTaskActionInput.findFirst({ where: {
        scopeId: proof.scopeId, taskId: proof.taskId, runId: proof.runId, id: step.inputRef,
        registrationRef: registrationRef(proof.selectionId), fingerprint: proof.inputHash,
        toolCode: 'rental.order.commit' } }) : null;
      if (!original || step?.requestFingerprint !== proof.inputHash) throw denied();
      await fresh(ref, proof.bindingHash);
      const proposal = await controlled.prepare(command);
      await fresh(ref, proof.bindingHash);
      return freezeOriginalInput({ stage: 'pending_human_approval' as const, proposal,
        selectionId: proof.selectionId, inputHash: proof.inputHash, order: 'not_created' as const });
    }
  });
}
