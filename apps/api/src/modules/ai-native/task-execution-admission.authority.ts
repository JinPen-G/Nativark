/** Ordinary-owner admission under a real published scene policy. The original
 * manager configuration Guard stays separate. Publication is checked inside
 * the original CAS transaction; its receipt stores policy CAS, not new proof. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AuthService } from '../auth/auth.service';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { AiExecutionContext } from '@rental-os/shared';
import { AiScopeRepository } from './ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import { AiTaskRepositoryError, aiTaskAccessFromContext } from './ai-task.repository';
import { AiBusinessReadRouteAuthority } from './business-read-route.authority';
import { AiOrderRouteContextAuthority } from './order-route-context.authority';
import type { PrismaOriginalRequestRepository } from './task-request/prisma-original-request.repository';
import { PrismaTaskActionPolicyRepository, type AiTaskActionPolicyMutationAuthority,
  type AiTaskActionPolicyMutationResult } from './prisma-task-action-policy.repository';
import type { TaskExecutionAdmissionReference } from './task-execution-admission.application';

export interface TaskExecutionAdmissionSigningDependencies {
  db: Pick<PrismaClient, '$transaction' | 'aiScope' | 'aiTask' | 'aiTaskActionPolicy' | 'aiTaskPlanPolicy' | 'operationLog' | 'rentalRuleVersion'>
    & Partial<Pick<PrismaClient, 'rentalBusinessCalendar'>>;
  auth: Pick<AuthService, 'resolveAccessContext'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiTaskCredentialSource;
  originals: Pick<PrismaOriginalRequestRepository, 'readTaskLocator' | 'readHistorical'>;
  clock?: () => Date;
}
export type TaskExecutionAdmissionSourceVerifier = (reference: TaskExecutionAdmissionReference,
  purpose: 'issue' | 'observe', tx?: Prisma.TransactionClient) => Promise<AiExecutionContext>;
type Action = TaskExecutionAdmissionReference['actions'][number];
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

export class TaskExecutionAdmissionAuthority implements AiTaskActionPolicyMutationAuthority {
  readonly scopes: AiScopeRepository;
  private readonly transactions = new AsyncLocalStorage<Prisma.TransactionClient>();
  private readonly commands = new AsyncLocalStorage<Action>();
  private readonly reference: TaskExecutionAdmissionReference;
  private readonly wall: () => Date;
  private readonly routes: AiBusinessReadRouteAuthority;
  constructor(private readonly d: TaskExecutionAdmissionSigningDependencies, reference: TaskExecutionAdmissionReference,
    private readonly purpose: 'issue' | 'observe', private readonly verify: TaskExecutionAdmissionSourceVerifier) {
    if (typeof d?.db?.$transaction !== 'function' || typeof d.db.aiScope?.findFirst !== 'function'
      || typeof d.db.operationLog?.findUnique !== 'function' || typeof d.db.operationLog.create !== 'function'
      || typeof d.auth?.resolveAccessContext !== 'function' || typeof d.guard?.canActivate !== 'function'
      || typeof d.credentials?.current !== 'function' || typeof d.originals?.readHistorical !== 'function'
      || typeof verify !== 'function') throw unavailable();
    this.reference = structuredClone(reference);
    this.wall = d.clock ?? (() => new Date());
    this.scopes = new AiScopeRepository(d.db, new AiTaskCurrentIdentityAuthority(d.auth, d.credentials, this.wall), this.wall);
    this.routes = new AiBusinessReadRouteAuthority(d.guard, d.credentials, this.wall);
  }

  async resolve(taskId: string, operation: 'configure_action_policy'): Promise<AiExecutionContext> {
    if (this.purpose !== 'issue' || !this.commands.getStore()) throw denied();
    return this.#authorize(taskId, operation);
  }

  async assertCurrent(): Promise<void> {
    if (this.purpose !== 'issue') throw denied();
    await this.#authorize(this.reference.task.taskId, 'configure_action_policy');
  }

  async #authorize(taskId: string, operation: 'configure_action_policy'): Promise<AiExecutionContext> {
    if (taskId !== this.reference.task.taskId || operation !== 'configure_action_policy') throw denied();
    const tx = this.transactions.getStore();
    const expected = structuredClone(await this.verify(this.reference, this.purpose, tx));
    const before = await this.scopes.resolveCurrent();
    const access = aiTaskAccessFromContext(expected, taskId, this.wall());
    const current = aiTaskAccessFromContext(before.context, taskId, this.wall());
    if (before.scope.id !== this.reference.task.scopeId || access.bindingKey !== current.bindingKey
      || expected.actor.kind !== 'user' || expected.audience !== 'operator' || expected.scope.kind !== 'workspace') throw denied();
    if (this.purpose === 'issue') {
      const original = await this.d.originals.readHistorical(this.reference.original, tx);
      const check = (context: AiExecutionContext) => {
        if (aiTaskAccessFromContext(context, taskId, this.wall()).bindingKey !== access.bindingKey) throw denied();
        return context;
      };
      if (this.reference.preparation?.kind === 'business_rule') {
        if (original.request.sceneCode !== 'opening_diagnosis' || !original.request.input.sections.includes('business_rule')
          || typeof this.d.db.rentalRuleVersion?.findFirst !== 'function') throw denied();
        const where = { id: this.reference.preparation.targetId, tenantId: expected.scope.tenantId,
          workspaceId: expected.scope.workspaceId };
        const version = await (tx ?? this.d.db).rentalRuleVersion.findFirst({ where, select: { id: true, tenantId: true, workspaceId: true } });
        if (!version || Object.entries(where).some(([key, value]) => version[key as keyof typeof version] !== value)) throw denied();
        // The real POST rule-version Guard, never the opening price read Guard.
        await this.routes.withRuleDraftPreview(version.id, async context => check(context));
      } else if (this.reference.preparation?.kind === 'business_calendar') {
        const selected = this.reference.preparation;
        if (original.request.sceneCode !== 'opening_diagnosis' || original.request.input.sections.length !== 1
          || original.request.input.sections[0] !== 'business_calendar'
          || Number(selected.date.slice(0, 4)) !== selected.year || !this.d.db.rentalBusinessCalendar) throw denied();
        const where = { id: selected.targetId, tenantId: expected.scope.tenantId, workspaceId: expected.scope.workspaceId,
          year: selected.year, version: selected.version, revision: selected.revision, status: 'draft' };
        const calendars = tx?.rentalBusinessCalendar ?? this.d.db.rentalBusinessCalendar;
        if (!calendars) throw denied();
        const row = await calendars.findFirst({ where });
        if (!row || Object.entries(where).some(([key, value]) => row[key as keyof typeof row] !== value) || !Array.isArray(row.days)) throw denied();
        const days = row.days.filter(day => day && typeof day === 'object' && !Array.isArray(day) && day.date === selected.date);
        if (days.length !== 1 || !days[0] || typeof days[0] !== 'object' || Array.isArray(days[0]) || typeof days[0].name !== 'string') throw denied();
        await this.routes.withCalendarRangePreview(selected.year, { startDate: selected.date, endDate: selected.date,
          fields: { name: days[0].name } }, async context => check(context));
      } else if (original.request.sceneCode === 'order_explanation') {
        await new AiOrderRouteContextAuthority(this.d.guard, this.d.credentials, original.request.input.orderId, this.wall)
          .withOrderRead(async context => check(context));
      } else if (original.request.sceneCode === 'quote_clarification') {
        await this.routes.withRead('quote_context', {}, async context => check(context));
      } else {
        await this.routes.withRead('opening', { limit: 50 }, async context => check(context));
      }
    }
    const after = await this.scopes.resolveCurrent();
    const verified = await this.verify(this.reference, this.purpose, tx);
    if (after.scope.id !== before.scope.id
      || aiTaskAccessFromContext(after.context, taskId, this.wall()).bindingKey !== access.bindingKey
      || aiTaskAccessFromContext(verified, taskId, this.wall()).bindingKey !== access.bindingKey) throw denied();
    return structuredClone(after.context);
  }

  #repository(action?: Action) {
    const reference = this.reference;
    if (this.purpose === 'issue' && (!action || action.mode !== 'configure'
      || !reference.actions.some(expected => isDeepStrictEqual(expected, action)))) throw denied();
    // The original writer still owns every create/update/CAS and original log.
    // This adapter only locks/rechecks its real publication in that transaction.
    // The original writer records its original CAS; no table write is added here.
    const transaction = (work: (tx: Prisma.TransactionClient) => Promise<AiTaskActionPolicyMutationResult>, options?: object) =>
      this.d.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_scopes WHERE id = ${reference.task.scopeId} FOR UPDATE`);
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
    const authority = this.purpose === 'issue' ? this : { resolve: (taskId: string, operation: 'configure_action_policy') =>
      this.#authorize(taskId, operation) };
    return new PrismaTaskActionPolicyRepository(db as ConstructorParameters<typeof PrismaTaskActionPolicyRepository>[0],
      this.scopes, authority, this.wall);
  }

  reader(): Pick<PrismaTaskActionPolicyRepository, 'read' | 'readMutation'> {
    if (this.purpose !== 'observe') throw denied();
    const repository = this.#repository();
    return Object.freeze({ read: repository.read.bind(repository), readMutation: repository.readMutation.bind(repository) });
  }

  writer(action: Action): Pick<PrismaTaskActionPolicyRepository, 'put'> {
    if (this.purpose !== 'issue') throw denied();
    const repository = this.#repository(action);
    const expected = structuredClone(action);
    return Object.freeze({ put: async (value, revision, recordOriginalReceipt = false) => {
      const command = structuredClone(value);
      if (!recordOriginalReceipt || revision !== expected.expectedRevision || command.taskId !== this.reference.task.taskId
        || command.operation !== expected.operation || !(command.expiresAt instanceof Date)
        || !Array.isArray(command.requiredPermissions)
        || command.expiresAt.toISOString() !== expected.expiresAt
        || !isDeepStrictEqual([...command.requiredPermissions].sort(), [...expected.requiredPermissions].sort())) throw denied();
      return this.commands.run(expected, () => repository.put(command, revision, true));
    } });
  }

}
