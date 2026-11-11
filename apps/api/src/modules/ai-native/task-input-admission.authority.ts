/** Command-bound policy CAS for one original input stage. The original writer
 * owns policy and receipt writes; these locks protect the existing Task/wait and
 * publication. A recorded CAS does not authorize a model or revive a question. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import { AiScopeRepository } from './ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { PrismaTaskActionPolicyRepository, type AiTaskActionPolicyMutationAuthority,
  type AiTaskActionPolicyMutationResult } from './prisma-task-action-policy.repository';
import type { TaskInputAdmissionDependencies, TaskInputAdmissionReference } from './task-input-admission.application';

type Action = TaskInputAdmissionReference['actions'][number];
type Purpose = 'issue' | 'observe';
export type TaskInputAdmissionVerifier = (reference: TaskInputAdmissionReference, purpose: Purpose,
  tx?: Prisma.TransactionClient) => Promise<AiExecutionContext>;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

export class TaskInputAdmissionAuthority implements AiTaskActionPolicyMutationAuthority {
  readonly scopes: AiScopeRepository;
  private readonly transactions = new AsyncLocalStorage<Prisma.TransactionClient>();
  private readonly commands = new AsyncLocalStorage<Action>();
  private readonly reference: TaskInputAdmissionReference;
  private readonly wall: () => Date;
  constructor(private readonly d: TaskInputAdmissionDependencies, reference: TaskInputAdmissionReference,
    private readonly purpose: Purpose, private readonly verify: TaskInputAdmissionVerifier) {
    if (typeof d.db?.$transaction !== 'function' || typeof d.db.operationLog?.findUnique !== 'function'
      || typeof d.db.operationLog?.create !== 'function' || typeof d.auth?.resolveAccessContext !== 'function'
      || typeof d.credentials?.current !== 'function' || typeof verify !== 'function') throw unavailable();
    this.reference = structuredClone(reference);
    this.wall = d.clock ?? (() => new Date());
    this.scopes = new AiScopeRepository(d.db, new AiTaskCurrentIdentityAuthority(d.auth, d.credentials, this.wall), this.wall);
  }
  async resolve(taskId: string, operation: 'configure_action_policy') {
    if (this.purpose !== 'issue' || !this.commands.getStore()) throw denied();
    return this.authorize(taskId, operation);
  }
  private async authorize(taskId: string, operation: 'configure_action_policy'): Promise<AiExecutionContext> {
    if (taskId !== this.reference.task.taskId || operation !== 'configure_action_policy') throw denied();
    const tx = this.transactions.getStore();
    const granted = await this.verify(this.reference, this.purpose, tx), current = await this.scopes.resolveCurrent();
    const expected = aiTaskAccessFromContext(granted, taskId, this.wall());
    if (current.scope.id !== this.reference.task.scopeId || granted.actor.kind !== 'user'
      || granted.audience !== 'operator' || granted.scope.kind !== 'workspace'
      || aiTaskAccessFromContext(current.context, taskId, this.wall()).bindingKey !== expected.bindingKey) throw denied();
    const checked = await this.verify(this.reference, this.purpose, tx);
    if (aiTaskAccessFromContext(checked, taskId, this.wall()).bindingKey !== expected.bindingKey) throw denied();
    return structuredClone(current.context);
  }
  private repository(action?: Action) {
    const reference = this.reference;
    if (this.purpose === 'issue' && (!action || action.mode !== 'configure'
      || !reference.actions.some(row => isDeepStrictEqual(row, action)))) throw denied();
    const transaction = (work: (tx: Prisma.TransactionClient) => Promise<AiTaskActionPolicyMutationResult>, options?: object) =>
      this.d.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_scopes WHERE id = ${reference.task.scopeId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${reference.task.scopeId} AND id = ${reference.task.taskId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${reference.task.scopeId}
          AND taskId = ${reference.task.taskId} AND id = ${reference.wait.runId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_task_input_requests WHERE scopeId = ${reference.task.scopeId}
          AND taskId = ${reference.task.taskId} AND id = ${reference.wait.requestId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT revision FROM ai_task_plan_policies WHERE scopeId = ${reference.task.scopeId}
          AND sceneCode = ${reference.task.sceneCode} AND sceneVersion = ${reference.task.sceneVersion} FOR UPDATE`);
        return this.transactions.run(tx, async () => {
          await this.resolve(reference.task.taskId, 'configure_action_policy');
          const result = structuredClone(await work(tx));
          await this.resolve(reference.task.taskId, 'configure_action_policy');
          return result;
        });
      }, options as Parameters<PrismaClient['$transaction']>[1]);
    const db = this.purpose === 'issue' ? { aiTask: this.d.db.aiTask, aiTaskActionPolicy: this.d.db.aiTaskActionPolicy,
      operationLog: this.d.db.operationLog, $transaction: transaction } : this.d.db;
    const authority = this.purpose === 'issue' ? this : { resolve: (taskId: string, operation: 'configure_action_policy') => this.authorize(taskId, operation) };
    return new PrismaTaskActionPolicyRepository(db as ConstructorParameters<typeof PrismaTaskActionPolicyRepository>[0], this.scopes, authority, this.wall);
  }
  reader(): Pick<PrismaTaskActionPolicyRepository, 'read' | 'readMutation'> {
    if (this.purpose !== 'observe') throw denied();
    const repository = this.repository();
    return Object.freeze({ read: repository.read.bind(repository), readMutation: repository.readMutation.bind(repository) });
  }
  writer(action: Action): Pick<PrismaTaskActionPolicyRepository, 'put'> {
    if (this.purpose !== 'issue') throw denied();
    const expected = structuredClone(action), repository = this.repository(expected);
    return Object.freeze({ put: async (value, revision, recorded = false) => {
      const command = structuredClone(value);
      if (!recorded || revision !== expected.expectedRevision || command.taskId !== this.reference.task.taskId
        || command.operation !== expected.operation || !(command.expiresAt instanceof Date)
        || command.expiresAt.toISOString() !== expected.expiresAt
        || !isDeepStrictEqual([...command.requiredPermissions].sort(), [...expected.requiredPermissions].sort())) throw denied();
      return this.commands.run(expected, () => repository.put(command, revision, true));
    } });
  }
}
