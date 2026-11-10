/** Original notification-policy CAS. Current Core route/category locks precede
 * Task/Run locks, matching the original settings approval transaction order.
 * The native repository owns policy and receipt writes; this grants no lease. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import { lockActiveCategoryBinding } from '../../rental-core/category-active-write';
import { ApprovedSettingsRouteAuthority } from '../../rental-core/approved-settings-route.authority';
import { AiScopeRepository } from '../ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from '../ai-task.repository';
import { PrismaTaskActionPolicyRepository, type AiTaskActionPolicyMutationAuthority,
  type AiTaskActionPolicyMutationResult } from '../prisma-task-action-policy.repository';
import type { SettingsApprovalAdmissionDependencies, SettingsApprovalAdmissionReference } from './settings-approval-admission.application';

type Action = SettingsApprovalAdmissionReference['actions'][number];
type Purpose = 'issue' | 'observe';
export type SettingsApprovalAdmissionVerifier = (reference: SettingsApprovalAdmissionReference, purpose: Purpose,
  tx?: Prisma.TransactionClient) => Promise<AiExecutionContext>;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED'), unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

export class SettingsApprovalAdmissionAuthority implements AiTaskActionPolicyMutationAuthority {
  readonly scopes: AiScopeRepository;
  private readonly transactions = new AsyncLocalStorage<Prisma.TransactionClient>();
  private readonly commands = new AsyncLocalStorage<Action>();
  private readonly reference: SettingsApprovalAdmissionReference;
  private readonly wall: () => Date;
  constructor(private readonly d: SettingsApprovalAdmissionDependencies, reference: SettingsApprovalAdmissionReference,
    private readonly purpose: Purpose, private readonly verify: SettingsApprovalAdmissionVerifier) {
    if (typeof d.db?.$transaction !== 'function' || typeof d.db.operationLog?.findUnique !== 'function'
      || typeof d.db.operationLog?.create !== 'function' || typeof d.auth?.resolveAccessContext !== 'function'
      || typeof d.guard?.canActivate !== 'function' || typeof d.credentials?.current !== 'function' || typeof verify !== 'function') throw unavailable();
    this.reference = structuredClone(reference); this.wall = d.clock ?? (() => new Date());
    this.scopes = new AiScopeRepository(d.db, new AiTaskCurrentIdentityAuthority(d.auth, d.credentials, this.wall), this.wall);
  }
  async resolve(taskId: string, operation: 'configure_action_policy') {
    if (this.purpose !== 'issue' || !this.commands.getStore()) throw denied();
    return this.authorize(taskId, operation);
  }
  private async authorize(taskId: string, operation: 'configure_action_policy'): Promise<AiExecutionContext> {
    if (taskId !== this.reference.target.taskId || operation !== 'configure_action_policy') throw denied();
    const granted = await this.verify(this.reference, this.purpose, this.transactions.getStore()), current = await this.scopes.resolveCurrent();
    if (current.scope.id !== this.reference.target.scopeId || granted.actor.kind !== 'user' || granted.actor.userId !== this.reference.target.ownerId
      || aiTaskAccessFromContext(current.context, taskId, this.wall()).bindingKey !== aiTaskAccessFromContext(granted, taskId, this.wall()).bindingKey) throw denied();
    return granted;
  }
  private repository(action?: Action) {
    if (this.purpose === 'issue' && (!action || action.mode !== 'configure' || !this.reference.actions.some(row => isDeepStrictEqual(row, action)))) throw denied();
    const target = this.reference.target;
    const transaction = (work: (tx: Prisma.TransactionClient) => Promise<AiTaskActionPolicyMutationResult>, options?: object) =>
      new ApprovedSettingsRouteAuthority(this.d.guard, this.d.credentials).withAuthorization('write', async (actor, revalidate) => {
        if (actor.actorId !== target.ownerId || actor.tenantId !== target.tenantId || actor.workspaceId !== target.workspaceId) throw denied();
        return this.d.db.$transaction(async tx => {
          await lockActiveCategoryBinding(tx, actor.tenantId, actor.workspaceId);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_scopes WHERE id = ${target.scopeId} FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${target.scopeId} AND id = ${target.taskId} FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${target.scopeId} AND taskId = ${target.taskId} AND id = ${target.runId} FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_steps WHERE scopeId = ${target.scopeId} AND taskId = ${target.taskId} AND id = ${target.stepId} FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM rental_approved_settings_changes WHERE id = ${target.change.changeId} FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_proposals WHERE scopeId = ${target.scopeId} AND taskId = ${target.taskId} AND id = ${target.proposal.proposalId} FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT revision FROM ai_task_plan_policies WHERE scopeId = ${target.scopeId}
            AND sceneCode = ${target.sceneCode} AND sceneVersion = ${target.sceneVersion} FOR UPDATE`);
          return this.transactions.run(tx, async () => {
            await this.resolve(target.taskId, 'configure_action_policy');
            const result = structuredClone(await work(tx));
            await this.resolve(target.taskId, 'configure_action_policy');
            await revalidate();
            return result;
          });
        }, options as Parameters<PrismaClient['$transaction']>[1]);
      });
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
      if (!recorded || revision !== expected.expectedRevision || command.taskId !== this.reference.target.taskId || command.operation !== expected.operation
        || !(command.expiresAt instanceof Date) || command.expiresAt.toISOString() !== expected.expiresAt
        || !isDeepStrictEqual([...command.requiredPermissions].sort(), [...expected.requiredPermissions].sort())) throw denied();
      return this.commands.run(expected, () => repository.put(command, revision, true));
    } });
  }
}
