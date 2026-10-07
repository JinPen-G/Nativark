import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/shared';
import { HumanKnowledgeService, knowledgeManagementView, type HumanKnowledgeDependencies } from './human-knowledge.service';
import { KnowledgeIndexCoordinator } from './knowledge-index-coordinator';
import { PrismaKnowledgeIndexAdapter, relationalIndexReceipt } from './prisma-knowledge-index.adapter';
import { KnowledgeError } from './knowledge-errors';
import { fingerprint, id, parse } from './knowledge-validation';

const resumeInput = z.object({ documentId: id, operationId: z.string().min(1).max(191),
  generation: z.number().int().min(1).max(4294967294) }).strict();

/** Only the existing transactional relational index. An external index is not
 * interchangeable: its unknown submit requires its own authoritative receipt.
 */
export class HumanKnowledgeIndexService {
  private readonly human: HumanKnowledgeService;
  private readonly coordinator: KnowledgeIndexCoordinator;
  constructor(ports: HumanKnowledgeDependencies) {
    this.human = new HumanKnowledgeService(ports);
    this.coordinator = new KnowledgeIndexCoordinator(this.human.documents,
      new PrismaKnowledgeIndexAdapter(ports.db, this.human.authorization));
  }
  request(value: unknown) {
    return this.human.session.run(async context => knowledgeManagementView(await this.coordinator.request(context, value)));
  }
  private async inspect(context: AiExecutionContext, documentId: string) {
    const before = await this.human.documents.load(context, documentId, 'index');
    if (!before.indexJob) return { head: before, receipt: 'not_queued' as const };
    const job = { ...before.indexJob, status: 'pending' as const };
    const expected = relationalIndexReceipt({ scope: context.scope, documentId, job });
    const receipt = await this.human.repository.operation(context.scope, documentId, expected.operationId);
    if (receipt && receipt.fingerprint !== expected.fingerprint) throw new KnowledgeError('conflict');
    const after = await this.human.documents.load(context, documentId, 'index');
    if (fingerprint(before) !== fingerprint(after)) throw new KnowledgeError('conflict');
    return { head: after, receipt: receipt ? 'recorded' as const : 'not_recorded' as const };
  }
  status(documentId: string) {
    parse(id, documentId);
    return this.human.session.run(async context => {
      const state = await this.inspect(context, documentId);
      return { document: knowledgeManagementView(state.head), receipt: state.receipt,
        nextStep: state.head.indexJob?.status === 'failed' ? 'manual' as const
          : state.head.indexJob?.status !== 'pending' ? 'none' as const
            : state.receipt === 'recorded' ? 'complete_same_job' as const : 'resume_same_relational_job' as const };
    });
  }
  resume(value: unknown) {
    const input = parse(resumeInput, value);
    return this.human.session.run(context => this.resumeCurrent(context, input));
  }
  /** Explicit human-selected jobs, not a background queue or automatic retry.
   * Fail-fast: earlier items may have committed; reconcile each original job.
   */
  resumeBatch(value: unknown) {
    const input = parse(z.object({ jobs: z.array(resumeInput).min(1).max(10) }).strict(), value);
    if (new Set(input.jobs.map(job => job.documentId)).size !== input.jobs.length) throw new KnowledgeError('invalid_input');
    return this.human.session.run(async context => {
      const items = [];
      for (const job of input.jobs) items.push(await this.resumeCurrent(context, job));
      return { items, semantics: 'independent_operations' as const };
    });
  }
  private async resumeCurrent(context: AiExecutionContext, input: z.infer<typeof resumeInput>) {
      const state = await this.inspect(context, input.documentId), job = state.head.indexJob;
      if (!job) throw new KnowledgeError('not_ready');
      if (job.operationId !== input.operationId || job.generation !== input.generation) throw new KnowledgeError('conflict');
      if (job.status === 'completed') return knowledgeManagementView(state.head);
      // No new operation or ad-hoc failed->pending state transition is invented.
      if (job.status === 'failed') throw new KnowledgeError('not_ready');
      const after = state.receipt === 'recorded'
        ? await this.coordinator.complete(context, input.documentId, job, 'completed')
        : await this.coordinator.runPending(context, input.documentId);
      return knowledgeManagementView(after);
  }
}
