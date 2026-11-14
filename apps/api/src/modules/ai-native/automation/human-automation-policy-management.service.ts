import { hasEffectivePermission } from '../../../common/permission-match';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AiAutomationPolicy, type AiAutomationPolicyPreparation, type AiAutomationPolicyManagementOperation } from '@prisma/client';
import { z } from 'zod';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { AuthService } from '../../auth/auth.service';
import type { AiExecutionContext, AiAutomationPolicyConstraintsDraft, AiAutomationPolicyDiscoveryDraft } from '@rental-os/shared';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { TenantModelConfigurationAuthority } from '../tenant-model-config.authority';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { AutomationManagementError, managementParse as parse, managementId, managementHash, managementRevision, policyChange,
  subjectConfiguration, policyConfiguration, enabledProvenance, managementResult, type PolicyChange } from './automation-management.validation';
import { recordOriginalAutomationPolicyBoundary, readOriginalAutomationPolicyBoundary,
  readRecordedAutomationPolicyBoundaryForManagement } from './automation-policy-boundary';

export type AutomationManagementDependencies = { auth: Pick<AuthService, 'resolveAccessContext'>; guard: Pick<ApiAuthGuard, 'canActivate'>; credentials: AiTaskCredentialSource };
type ReadDb = Pick<PrismaClient, 'aiScope' | 'businessWorkspace' | 'rentalFulfillmentLocation' | 'aiTaskPlanPolicy' | 'aiAutomationSubject'
  | 'aiAutomationPolicy' | 'aiAutomationManagementGrant' | 'aiAutomationPolicyPreparation' | 'aiAutomationPolicyManagementOperation' | 'operationLog'>;
type Access = Awaited<ReturnType<HumanAutomationPolicyManagementService['access']>>;
const selection = z.object({ preparationId: z.string().uuid() }).strict();
const operationSelection = z.object({ operationKey: managementId.max(128) }).strict();
const commitInput = selection.extend({ changeHash: managementHash, confirm: z.literal('apply_automation_policy_change') }).strict();
const unavailable = () => new AutomationManagementError('unavailable');
const conflict = () => new AutomationManagementError('conflict');
const identityHash = (c: AiExecutionContext) => hash({ actor: c.actor, audience: c.audience, scope: c.scope, access: 'access' in c ? c.access : null });
const semantics = { executionPermission: false as const, businessActionRequested: false as const };
const constraintsFor = (boundary: NonNullable<Awaited<ReturnType<typeof readOriginalAutomationPolicyBoundary>>>): AiAutomationPolicyConstraintsDraft => ({
  allowedTools: boundary.allowedTools, allowedRecipientIds: boundary.allowedRecipientIds,
  limits: { maxActionsPerRun: boundary.limits.maxActionsPerRun, maxQuantity: boundary.limits.maxQuantity,
    maxCausalDepth: boundary.limits.maxCausalDepth } });

export class HumanAutomationPolicyManagementService {
  private readonly identity: AiTaskCurrentIdentityAuthority;
  private readonly original: TenantModelConfigurationAuthority;
  private readonly transactions = new AsyncLocalStorage<Prisma.TransactionClient>();
  constructor(private readonly storage: ReadDb & Pick<PrismaClient, '$transaction'>, input: AutomationManagementDependencies,
    private readonly clock: () => Date = () => new Date()) {
    this.identity = new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, clock);
    this.original = new TenantModelConfigurationAuthority(input.guard, input.credentials, this.identity);
  }
  private get db(): ReadDb & Pick<PrismaClient, '$transaction'> {
    const tx = this.transactions.getStore();
    if (!tx) return this.storage;
    return new Proxy(this.storage, { get(target, key) {
      // Confirmed metadata commands join their caller-owned transaction. No
      // grant can commit separately from its preparation or policy receipt.
      if (key === '$transaction') return (work: (native: Prisma.TransactionClient) => Promise<unknown>) => work(tx);
      return Reflect.get(tx, key) ?? Reflect.get(target, key);
    } });
  }

  private async access(action: 'read' | 'manage') {
    const current = await this.identity.resolve();
    if (current.actor.kind !== 'user' || current.scope.kind !== 'workspace' || current.audience !== 'operator'
      || !('access' in current) || current.access.dataScope !== 'all') throw unavailable();
    const scope = { tenantId: current.scope.tenantId, workspaceId: current.scope.workspaceId };
    await this.original.authorize({ ...scope, actorId: current.actor.userId }, action);
    const expected = aiPersistenceScopeColumns(current.scope);
    const row = await this.db.aiScope.findFirst({ where: expected });
    const workspace = await this.db.businessWorkspace.findFirst({ where: { id: scope.workspaceId, tenantId: scope.tenantId, status: 'ACTIVE' }, select: { id: true, tenantId: true, status: true } });
    if (!row || Object.entries(expected).some(([name, value]) => row[name as keyof typeof row] !== value)
      || !workspace || workspace.id !== scope.workspaceId || workspace.tenantId !== scope.tenantId || workspace.status !== 'ACTIVE'
      || identityHash(await this.identity.resolve()) !== identityHash(current)) throw unavailable();
    return { scope, scopeId: row.id, person: { actorKind: 'user' as const, actorId: current.actor.userId, audience: 'operator' as const },
      permissions: current.access.permissions, locationScope: current.access.locationScope, identityHash: identityHash(current) };
  }
  private async sameAccess(before: Access, action: 'read' | 'manage') {
    const after = await this.access(action);
    if (after.scopeId !== before.scopeId || after.identityHash !== before.identityHash) throw unavailable();
  }
  private async policySettings(row: AiAutomationPolicy, subject: Parameters<typeof subjectConfiguration>[0], db: ReadDb) {
    const settings = policyConfiguration(row), boundary = await readRecordedAutomationPolicyBoundaryForManagement(db, row, subject);
    return boundary ? { ...settings, constraints: constraintsFor(boundary) } : settings;
  }
  private key(access: Access, operationKey: string) { return { scopeId: access.scopeId, actorId: access.person.actorId, audience: access.person.audience, operationKey }; }
  private changeHash(access: Access, command: PolicyChange) { return hash({ version: 'automation-policy-change-1', scope: access.scope, person: access.person, command }); }
  private commitHash(row: Pick<AiAutomationPolicyPreparation, 'id' | 'changeHash' | 'sourceHash' | 'subjectId' | 'policyId' | 'expiresAt'>) {
    return hash({ version: 'automation-policy-commit-1', preparationId: row.id, changeHash: row.changeHash, sourceHash: row.sourceHash,
      subjectId: row.subjectId, policyId: row.policyId, expiresAt: row.expiresAt.toISOString() });
  }

  private restrictions(command: PolicyChange, access: Access, time: boolean) {
    const { subject, policy } = command;
    if (subject.permissions.some(permission => !hasEffectivePermission(access.permissions, permission))) throw unavailable();
    if (policy.constraints && (policy.constraints.allowedTools.length || policy.constraints.allowedRecipientIds.length)) {
      // This first publication is shadow/manual-only. A proposed whitelist
      // cannot open a business tool or invent notification recipients.
      throw new AutomationManagementError('invalid_input');
    }
    if (policy.constraints && (policy.maxTasksPerDay < 1 || policy.maxTasksPerDay > 1000)) throw new AutomationManagementError('invalid_input');
    if (access.locationScope.mode === 'selected') {
      const allowed = access.locationScope.locationIds;
      if (subject.locationScope.mode !== 'selected' || subject.locationScope.locationIds.some(location => !allowed.includes(location))) throw unavailable();
    }
    if (!command.subjectId && (subject.enabled || subject.revoked) || !command.policyId && (policy.mode !== 'disabled' || policy.revoked)
      || subject.revoked && subject.enabled || policy.revoked && policy.mode !== 'disabled'
      || policy.mode !== 'disabled' && (!subject.enabled || subject.revoked || policy.maxTasksPerDay < 1)
      || Date.parse(policy.validFrom) >= Date.parse(policy.expiresAt) || Date.parse(policy.expiresAt) > Date.parse(subject.expiresAt)) throw new AutomationManagementError('invalid_input');
    if (time && (((!command.subjectId || subject.enabled) && (Date.parse(subject.expiresAt) <= this.clock().getTime()
      || Date.parse(subject.expiresAt) > this.clock().getTime() + 366 * 86400000))
      || (!command.policyId || policy.mode !== 'disabled') && Date.parse(policy.expiresAt) <= this.clock().getTime())) throw new AutomationManagementError('invalid_input');
  }

  private async sources(command: PolicyChange, access: Access, db: ReadDb, time = true) {
    this.restrictions(command, access, time);
    const subject = command.subjectId ? await db.aiAutomationSubject.findFirst({ where: { id: command.subjectId, ...access.scope } }) : null;
    const policy = command.policyId ? await db.aiAutomationPolicy.findFirst({ where: { id: command.policyId, ...access.scope } }) : null;
    if (command.subjectId && (!subject || subject.id !== command.subjectId || subject.tenantId !== access.scope.tenantId || subject.workspaceId !== access.scope.workspaceId)
      || command.policyId && (!policy || policy.id !== command.policyId || policy.tenantId !== access.scope.tenantId || policy.workspaceId !== access.scope.workspaceId || policy.subjectId !== subject?.id)) throw unavailable();
    if ((subject?.authorizationRevision ?? null) !== command.expectedSubjectRevision || (policy?.revision ?? null) !== command.expectedPolicyRevision) throw conflict();
    if (subject?.revokedAt && !command.subject.revoked || policy?.revokedAt && !command.policy.revoked) throw unavailable();
    if (command.subject.locationScope.mode === 'selected') {
      const ids = command.subject.locationScope.locationIds;
      const rows = await db.rentalFulfillmentLocation.findMany({ where: { ...access.scope, id: { in: ids } }, take: 100, select: { id: true, tenantId: true, workspaceId: true } });
      if (rows.length !== ids.length || rows.some(row => !ids.includes(row.id) || row.tenantId !== access.scope.tenantId || row.workspaceId !== access.scope.workspaceId)) throw unavailable();
    }
    const planKey = { scopeId: access.scopeId, sceneCode: command.policy.sceneCode, sceneVersion: command.policy.sceneVersion };
    const plan = await db.aiTaskPlanPolicy.findFirst({ where: planKey });
    if (!plan || Object.entries(planKey).some(([name, value]) => plan[name as keyof typeof plan] !== value)
      || !managementRevision.safeParse(plan.revision).success
      || time && (!command.policyId || command.policy.mode !== 'disabled') && plan.expiresAt <= this.clock()) throw unavailable();
    const limits = parse(aiTaskRunnerLimitsSchema, plan.limits);
    if (limits.maxStepMs > limits.maxTotalMs) throw unavailable();
    if (command.policy.constraints && command.policy.mode !== 'disabled') {
      const tools = parse(z.array(z.object({ code: managementId, version: managementId }).strict()).min(1).max(1000), plan.allowedTools);
      if (!plan.enabled || tools.length !== 1 || tools[0].code !== 'ai.model.text'
        || command.policy.constraints.limits.maxCausalDepth < 1
        || limits.maxSteps > command.policy.constraints.limits.maxActionsPerRun
        || limits.maxCalls > command.policy.constraints.limits.maxActionsPerRun) throw unavailable();
    }
    const observedBoundary = policy && subject ? await readRecordedAutomationPolicyBoundaryForManagement(db, policy, subject) : undefined;
    if (observedBoundary && !command.policy.constraints) throw conflict();
    const before = { subject: subject ? { id: subject.id, revision: subject.authorizationRevision, settings: subjectConfiguration(subject), ...enabledProvenance(subject) } : null,
      policy: policy && subject ? { id: policy.id, subjectId: policy.subjectId, revision: policy.revision,
        settings: { ...policyConfiguration(policy), ...(observedBoundary ? { constraints: constraintsFor(observedBoundary) } : {}) },
        ...enabledProvenance(policy) } : null,
      scene: { ...planKey, revision: plan.revision, enabled: plan.enabled, tools: plan.allowedTools, limits, expiresAt: plan.expiresAt.toISOString() } };
    return { subject, policy, before, sourceHash: hash(before),
      boundaryRebindRequired: Boolean(observedBoundary && subject
        && observedBoundary.subject.authorizationRevision !== subject.authorizationRevision) };
  }

  private async grant(access: Access, action: 'prepare' | 'commit', resourceHash: string, db: ReadDb) {
    const key = { scopeId: access.scopeId, actorId: access.person.actorId, audience: access.person.audience, action, resourceHash };
    const row = await db.aiAutomationManagementGrant.findFirst({ where: key });
    if (!row || Object.entries(key).some(([name, value]) => row[name as keyof typeof row] !== value)
      || row.actorKind !== 'user' || row.tenantId !== access.scope.tenantId || row.workspaceId !== access.scope.workspaceId
      || !row.enabled || !managementRevision.safeParse(row.revision).success || row.expiresAt <= this.clock()
      || !Array.isArray(row.requiredPermissions) || !row.requiredPermissions.length || row.requiredPermissions.length > 64
      || new Set(row.requiredPermissions).size !== row.requiredPermissions.length
      || row.requiredPermissions.some(permission => typeof permission !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,190}$/u.test(permission) || !hasEffectivePermission(access.permissions, permission))) throw unavailable();
    await this.sameAccess(access, 'manage');
    return { id: row.id, revision: row.revision, expiresAt: row.expiresAt, authorizationHash: hash({ key, id: row.id,
      revision: row.revision, expiresAt: row.expiresAt.toISOString(), permissions: row.requiredPermissions, identity: access.identityHash }) };
  }

  /** Explicit command-bound metadata grant. It uses the current original
   * configuration manager and CAS; never invoked by discovery, task creation
   * or the old prepare/commit endpoints and never grants model/business use. */
  private async issueConfirmedGrant(action: 'prepare' | 'commit', resourceHash: string, access: Access, expiresAt: Date) {
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= this.clock()) throw unavailable();
    const key = { scopeId: access.scopeId, actorId: access.person.actorId, audience: access.person.audience, action, resourceHash };
    let attempted = false;
    try {
      await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_scopes WHERE id = ${access.scopeId} FOR UPDATE`);
        await this.sameAccess(access, 'manage');
        const existing = await tx.aiAutomationManagementGrant.findFirst({ where: key });
        if (existing) { await this.grant(access, action, resourceHash, tx); return; }
        const requiredPermissions = ['system:params:manage'], revision = 1, id = randomUUID();
        attempted = true;
        await tx.aiAutomationManagementGrant.create({ data: { id, ...access.scope, ...access.person, ...key,
          revision, requiredPermissions, enabled: true, expiresAt } });
        const payload = { version: 'automation-manager-confirmed-grant-1', key, id, revision, requiredPermissions,
          expiresAt: expiresAt.toISOString(), identityHash: access.identityHash };
        await tx.operationLog.create({ data: { id: `automation-grant:${hash(key)}`, tenantId: access.scope.tenantId,
          workspaceId: access.scope.workspaceId, userId: access.person.actorId,
          action: 'ai_native_automation_confirmed_management_grant', detail: { payload, payloadHash: hash(payload) } } });
        await this.grant(access, action, resourceHash, tx);
        await this.sameAccess(access, 'manage');
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      await this.sameAccess(access, 'manage');
    } catch (error) { if (attempted) throw new AutomationManagementError('result_unknown'); throw error; }
  }

  async prepareConfirmed(value: unknown) {
    const input = parse(z.object({ decision: z.literal('prepare_original_automation_policy'), command: policyChange,
      changeHash: managementHash, sourceHash: managementHash }).strict(), value);
    const command = input.command, existing = await this.preparation({ operationKey: command.operationKey });
    if (existing.state !== 'not_observed') {
      if ('changeHash' in existing && existing.changeHash !== input.changeHash) throw conflict();
      return existing;
    }
    const access = await this.access('manage'), preview = await this.preview(command);
    if (preview.changeHash !== input.changeHash || preview.sourceHash !== input.sourceHash || !command.policy.constraints) throw conflict();
    // Disabling an existing expired publication must remain possible. Metadata
    // authorization ends with this preparation; expired business use never
    // becomes a new grant, and new/enabled targets keep their original TTL.
    const deadlines = [this.clock().getTime() + 600000];
    if (!command.subjectId || command.subject.enabled) deadlines.push(Date.parse(command.subject.expiresAt));
    if (!command.policyId || command.policy.mode !== 'disabled') deadlines.push(Date.parse(command.policy.expiresAt));
    const limit = Math.min(...deadlines);
    try {
      const prepared = await this.storage.$transaction(tx => this.transactions.run(tx, async () => {
        await this.issueConfirmedGrant('prepare', preview.prepareResourceHash, access, new Date(limit));
        const current = await this.preview(command);
        if (current.changeHash !== input.changeHash || current.sourceHash !== input.sourceHash) throw conflict();
        const result = await this.prepare(command);
        if (result.state === 'unknown') throw new AutomationManagementError('result_unknown');
        await this.sameAccess(access, 'manage');
        return result;
      }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      await this.sameAccess(access, 'manage');
      return prepared;
    } catch (error) {
      if (error instanceof AutomationManagementError && error.code !== 'result_unknown') throw error;
      return { state: 'unknown' as const, operationKey: command.operationKey, retryable: false as const,
        nextAction: 'read_preparation' as const, ...semantics };
    }
  }

  async commitConfirmed(value: unknown) {
    const input = parse(z.object({ decision: z.literal('apply_original_automation_policy'), preparationId: z.string().uuid(),
      changeHash: managementHash }).strict(), value), reader = await this.access('read');
    const prepared = await this.prepared(input.preparationId, reader);
    if (prepared.row.changeHash !== input.changeHash || !prepared.command.policy.constraints) throw conflict();
    const original = await this.operation({ operationKey: prepared.row.operationKey });
    if (original.state !== 'not_observed') return original;
    const access = await this.access('manage');
    if (access.scopeId !== reader.scopeId || access.identityHash !== reader.identityHash) throw unavailable();
    try {
      const result = await this.storage.$transaction(tx => this.transactions.run(tx, async () => {
        await this.issueConfirmedGrant('commit', prepared.row.commitResourceHash, access, prepared.row.expiresAt);
        const result = await this.commit({ preparationId: input.preparationId, changeHash: input.changeHash,
          confirm: 'apply_automation_policy_change' });
        if (result.state === 'unknown') throw new AutomationManagementError('result_unknown');
        await this.sameAccess(access, 'manage');
        return result;
      }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      await this.sameAccess(access, 'manage');
      return result;
    } catch (error) {
      if (error instanceof AutomationManagementError && error.code !== 'result_unknown') throw error;
      return { state: 'unknown' as const, operationKey: prepared.row.operationKey, preparationId: input.preparationId,
        retryable: false as const, nextAction: 'read_operation' as const, ...semantics };
    }
  }

  async discover(value: unknown): Promise<AiAutomationPolicyDiscoveryDraft> {
    parse(z.object({}).strict(), value);
    const access = await this.access('read');
    const subjectRows = await this.db.aiAutomationSubject.findMany({ where: access.scope, orderBy: { id: 'asc' }, take: 20 });
    const subjects = [];
    for (const row of subjectRows) {
      if (row.tenantId !== access.scope.tenantId || row.workspaceId !== access.scope.workspaceId) throw unavailable();
      const settings = subjectConfiguration(row);
      if (access.locationScope.mode === 'selected' && (settings.locationScope.mode !== 'selected'
        || settings.locationScope.locationIds.some(id => !access.locationScope.locationIds.includes(id)))) continue;
      subjects.push({ id: row.id, authorizationRevision: row.authorizationRevision, ...settings, ...enabledProvenance(row) });
    }
    const policyRows = await this.db.aiAutomationPolicy.findMany({ where: access.scope, orderBy: { id: 'asc' }, take: 20 });
    const policies = [];
    for (const row of policyRows) {
      const subject = subjectRows.find(subject => subject.id === row.subjectId);
      if (!subject || !subjects.some(subject => subject.id === row.subjectId)) continue;
      if (row.tenantId !== access.scope.tenantId || row.workspaceId !== access.scope.workspaceId) throw unavailable();
      policies.push({ id: row.id, subjectId: row.subjectId, revision: row.revision,
        ...await this.policySettings(row, subject, this.db), ...enabledProvenance(row),
        counterDay: row.counterDay?.toISOString() ?? null, preparedCount: row.preparedCount, lastPreparedAt: row.lastPreparedAt?.toISOString() ?? null });
    }
    const rows = await this.db.aiTaskPlanPolicy.findMany({ where: { scopeId: access.scopeId }, orderBy: [{ sceneCode: 'asc' }, { sceneVersion: 'asc' }], take: 20 });
    const scenes = rows.map(row => {
      if (row.scopeId !== access.scopeId || !managementRevision.safeParse(row.revision).success || !(row.expiresAt instanceof Date)) throw unavailable();
      return { sceneCode: row.sceneCode, sceneVersion: row.sceneVersion, revision: row.revision, enabled: row.enabled,
        tools: parse(z.array(z.object({ code: managementId, version: managementId }).strict()).max(1000), row.allowedTools),
        limits: parse(aiTaskRunnerLimitsSchema, row.limits), expiresAt: row.expiresAt.toISOString() };
    });
    await this.sameAccess(access, 'read');
    return { subjects, policies, scenes, coverage: 'bounded_current_workspace', ...semantics };
  }

  private verifyPreparation(row: AiAutomationPolicyPreparation, access: Access) {
    const command = parse(policyChange, row.commandJson);
    if (row.tenantId !== access.scope.tenantId || row.workspaceId !== access.scope.workspaceId || row.scopeId !== access.scopeId
      || row.actorId !== access.person.actorId || row.actorKind !== 'user' || row.audience !== access.person.audience
      || row.operationKey !== command.operationKey || row.changeHash !== this.changeHash(access, command)
      || row.expectedSubjectRevision !== command.expectedSubjectRevision || row.expectedPolicyRevision !== command.expectedPolicyRevision
      || (command.subjectId ? command.subjectId !== row.subjectId : !z.string().uuid().safeParse(row.subjectId).success)
      || (command.policyId ? command.policyId !== row.policyId : !z.string().uuid().safeParse(row.policyId).success)
      || !managementHash.safeParse(row.sourceHash).success || row.commitResourceHash !== this.commitHash(row)) throw conflict();
    this.restrictions(command, access, false);
    return command;
  }
  private async prepared(id: string, access: Access, db: ReadDb = this.db) {
    const row = await db.aiAutomationPolicyPreparation.findFirst({ where: { id, ...access.scope, ...access.person, scopeId: access.scopeId } });
    if (!row || row.id !== id) throw unavailable();
    return { row, command: this.verifyPreparation(row, access) };
  }
  private receipt(row: AiAutomationPolicyManagementOperation, prep: AiAutomationPolicyPreparation, access: Access) {
    const command = this.verifyPreparation(prep, access), result = parse(managementResult, row.result);
    if (row.tenantId !== access.scope.tenantId || row.workspaceId !== access.scope.workspaceId || row.scopeId !== access.scopeId
      || row.actorId !== access.person.actorId || row.actorKind !== 'user' || row.audience !== access.person.audience
      || row.operationKey !== prep.operationKey || row.preparationId !== prep.id || row.subjectId !== prep.subjectId || row.policyId !== prep.policyId
      || row.changeHash !== prep.changeHash || row.resultHash !== hash(row.result) || result.subject.id !== prep.subjectId
      || result.policy.id !== prep.policyId || result.policy.subjectId !== prep.subjectId
      || result.subject.enabled !== command.subject.enabled || result.subject.revoked !== command.subject.revoked
      || result.policy.mode !== command.policy.mode || result.policy.revoked !== command.policy.revoked) throw conflict();
    return { state: 'observed' as const, operationId: row.id, operationKey: row.operationKey, preparationId: row.preparationId,
      changeHash: row.changeHash, result, recordedAt: row.createdAt.toISOString(), retryable: false as const, ...semantics };
  }

  async read(value: unknown) {
    const selected = parse(z.object({ subjectId: managementId.max(36), policyId: managementId.max(36) }).strict(), value);
    const access = await this.access('read');
    const subject = await this.db.aiAutomationSubject.findFirst({ where: { id: selected.subjectId, ...access.scope } });
    const policy = await this.db.aiAutomationPolicy.findFirst({ where: { id: selected.policyId, subjectId: selected.subjectId, ...access.scope } });
    if (!subject || !policy || subject.id !== selected.subjectId || policy.id !== selected.policyId || policy.subjectId !== subject.id
      || subject.tenantId !== access.scope.tenantId || subject.workspaceId !== access.scope.workspaceId
      || policy.tenantId !== access.scope.tenantId || policy.workspaceId !== access.scope.workspaceId) throw unavailable();
    const settings = subjectConfiguration(subject);
    if (access.locationScope.mode === 'selected') {
      const allowed = access.locationScope.locationIds;
      if (settings.locationScope.mode !== 'selected' || settings.locationScope.locationIds.some(location => !allowed.includes(location))) throw unavailable();
    }
    const result = parse(managementResult, { subject: { id: subject.id, authorizationRevision: subject.authorizationRevision, ...settings, ...enabledProvenance(subject) },
      policy: { id: policy.id, subjectId: policy.subjectId, revision: policy.revision,
        ...await this.policySettings(policy, subject, this.db), ...enabledProvenance(policy),
        counterDay: policy.counterDay?.toISOString() ?? null, preparedCount: policy.preparedCount, lastPreparedAt: policy.lastPreparedAt?.toISOString() ?? null } });
    await this.sameAccess(access, 'read');
    return { state: 'configured' as const, ...result, ...semantics };
  }

  async preview(value: unknown) {
    const command = parse(policyChange, value), access = await this.access('read');
    const source = await this.sources(command, access, this.db), changeHash = this.changeHash(access, command);
    await this.sameAccess(access, 'read');
    return { command, before: source.before, changeHash, sourceHash: source.sourceHash,
      prepareResourceHash: hash({ changeHash, sourceHash: source.sourceHash }), ...semantics };
  }

  async prepare(value: unknown) {
    const command = parse(policyChange, value), reader = await this.access('read'), key = this.key(reader, command.operationKey);
    const existing = await this.db.aiAutomationPolicyPreparation.findFirst({ where: key });
    if (existing) {
      this.verifyPreparation(existing, reader);
      if (existing.changeHash !== this.changeHash(reader, command)) throw conflict();
      return this.review({ preparationId: existing.id });
    }
    const access = await this.access('manage');
    if (access.identityHash !== reader.identityHash || access.scopeId !== reader.scopeId) throw unavailable();
    const source = await this.sources(command, access, this.db), changeHash = this.changeHash(access, command);
    const prepareResourceHash = hash({ changeHash, sourceHash: source.sourceHash });
    const grant = await this.grant(access, 'prepare', prepareResourceHash, this.db);
    const id = randomUUID(), subjectId = command.subjectId ?? randomUUID(), policyId = command.policyId ?? randomUUID();
    const deadlines = [this.clock().getTime() + 600000, grant.expiresAt.getTime()];
    if (!command.subjectId || command.subject.enabled) deadlines.push(Date.parse(command.subject.expiresAt));
    if (!command.policyId || command.policy.mode !== 'disabled') deadlines.push(Date.parse(command.policy.expiresAt));
    const expiresAt = new Date(Math.min(...deadlines));
    const core = { id, subjectId, policyId, expiresAt, changeHash, sourceHash: source.sourceHash };
    try {
      await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_automation_management_grants WHERE id = ${grant.id} FOR UPDATE`);
        if ((await this.grant(access, 'prepare', prepareResourceHash, tx)).authorizationHash !== grant.authorizationHash
          || (await this.sources(command, access, tx)).sourceHash !== source.sourceHash) throw conflict();
        await tx.aiAutomationPolicyPreparation.create({ data: { ...core, ...access.scope, ...access.person, scopeId: access.scopeId,
          operationKey: command.operationKey, expectedSubjectRevision: command.expectedSubjectRevision, expectedPolicyRevision: command.expectedPolicyRevision,
          commandJson: command, commitResourceHash: this.commitHash(core), prepareGrantId: grant.id, prepareGrantRevision: grant.revision, authorizationHash: grant.authorizationHash } });
        if ((await this.grant(access, 'prepare', prepareResourceHash, tx)).authorizationHash !== grant.authorizationHash) throw unavailable();
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AutomationManagementError) throw error;
      const latest = await this.access('read');
      if (latest.identityHash !== access.identityHash) throw unavailable();
      let winner: AiAutomationPolicyPreparation | null;
      try { winner = await this.db.aiAutomationPolicyPreparation.findFirst({ where: key }); }
      catch { winner = null; }
      if (!winner) return { state: 'unknown' as const, operationKey: command.operationKey, preparationId: id, retryable: false as const, nextAction: 'read_preparation' as const, ...semantics };
      this.verifyPreparation(winner, latest);
      if (winner.changeHash !== changeHash) throw conflict();
      return this.review({ preparationId: winner.id });
    }
    return this.review({ preparationId: id });
  }

  async preparation(value: unknown) {
    const { operationKey } = parse(operationSelection, value), access = await this.access('read');
    const row = await this.db.aiAutomationPolicyPreparation.findFirst({ where: this.key(access, operationKey) });
    await this.sameAccess(access, 'read');
    if (!row) return { state: 'not_observed' as const, operationKey, retryable: false as const, ...semantics };
    if (row.operationKey !== operationKey) throw conflict();
    return this.review({ preparationId: row.id });
  }
  async review(value: unknown) {
    const { preparationId } = parse(selection, value), access = await this.access('read');
    const { row, command } = await this.prepared(preparationId, access);
    const operation = await this.db.aiAutomationPolicyManagementOperation.findFirst({ where: this.key(access, row.operationKey) });
    if (operation) { await this.sameAccess(access, 'read'); return this.receipt(operation, row, access); }
    let state: 'prepared' | 'expired' | 'stale' = row.expiresAt <= this.clock() ? 'expired' : 'prepared';
    try { if ((await this.sources(command, access, this.db, false)).sourceHash !== row.sourceHash) state = 'stale'; }
    catch (error) { if (error instanceof AutomationManagementError && error.code === 'conflict') state = 'stale'; else throw error; }
    await this.sameAccess(access, 'read');
    return { state, preparationId: row.id, operationKey: row.operationKey, subjectId: row.subjectId, policyId: row.policyId,
      changeHash: row.changeHash, commitResourceHash: row.commitResourceHash, proposal: command, expiresAt: row.expiresAt.toISOString(), ...semantics };
  }
  async operation(value: unknown) {
    const { operationKey } = parse(operationSelection, value), access = await this.access('read');
    let operation: AiAutomationPolicyManagementOperation | null;
    try { operation = await this.db.aiAutomationPolicyManagementOperation.findFirst({ where: this.key(access, operationKey) }); }
    catch { await this.sameAccess(access, 'read'); return { state: 'unknown' as const, operationKey, retryable: false as const, ...semantics }; }
    if (!operation) { await this.sameAccess(access, 'read'); return { state: 'not_observed' as const, operationKey, retryable: false as const, ...semantics }; }
    const { row } = await this.prepared(operation.preparationId, access);
    if (operation.operationKey !== operationKey) throw conflict();
    const result = this.receipt(operation, row, access);
    await this.sameAccess(access, 'read');
    return result;
  }

  async commit(value: unknown) {
    const input = parse(commitInput, value), reader = await this.access('read');
    const { row: prepared } = await this.prepared(input.preparationId, reader);
    if (prepared.changeHash !== input.changeHash) throw conflict();
    const key = this.key(reader, prepared.operationKey);
    const existing = await this.db.aiAutomationPolicyManagementOperation.findFirst({ where: key });
    if (existing) { const result = this.receipt(existing, prepared, reader); await this.sameAccess(reader, 'read'); return result; }
    const access = await this.access('manage');
    if (access.identityHash !== reader.identityHash || access.scopeId !== reader.scopeId) throw unavailable();
    let attempted = false, acknowledged = false;
    try {
      const result = await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_automation_policy_preparations WHERE id = ${prepared.id} FOR UPDATE`);
        const { row, command } = await this.prepared(prepared.id, access, tx);
        const replay = await tx.aiAutomationPolicyManagementOperation.findFirst({ where: key });
        if (replay) return this.receipt(replay, row, access);
        if (row.expiresAt <= this.clock()) throw unavailable();
        if (command.policyId) await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_automation_policies WHERE id = ${command.policyId} FOR UPDATE`);
        if (command.subjectId) await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_automation_subjects WHERE id = ${command.subjectId} FOR UPDATE`);
        const source = await this.sources(command, access, tx);
        if (source.sourceHash !== row.sourceHash) throw conflict();
        const grant = await this.grant(access, 'commit', row.commitResourceHash, tx);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_automation_management_grants WHERE id = ${grant.id} FOR UPDATE`);
        if ((await this.grant(access, 'commit', row.commitResourceHash, tx)).authorizationHash !== grant.authorizationHash) throw unavailable();
        const now = this.clock(), enabled = { enabledBy: access.person.actorId, enabledAudience: access.person.audience, enabledAt: now };
        const { revoked: subjectRevoked, expiresAt: subjectExpiry, ...subjectFields } = command.subject;
        const { revoked: policyRevoked, validFrom, expiresAt: policyExpiry, constraints, ...policyFields } = command.policy;
        const subjectChanged = source.subject && hash(subjectConfiguration(source.subject)) !== hash(command.subject);
        const policyChanged = subjectChanged || source.boundaryRebindRequired || hash(source.before.policy?.settings) !== hash(command.policy);
        attempted = true;
        if (!source.subject) {
          await tx.aiAutomationSubject.create({ data: { id: row.subjectId, ...access.scope, ...subjectFields, authorizationRevision: 1,
            expiresAt: new Date(subjectExpiry), revokedAt: null, enabledBy: null, enabledAudience: null, enabledAt: null } });
        } else if (subjectChanged) {
          const updated = await tx.aiAutomationSubject.updateMany({ where: { id: row.subjectId, ...access.scope, authorizationRevision: command.expectedSubjectRevision! },
            data: { ...subjectFields, authorizationRevision: { increment: 1 }, expiresAt: new Date(subjectExpiry),
              revokedAt: subjectRevoked ? source.subject.revokedAt ?? now : null, ...(subjectFields.enabled ? enabled : {}) } });
          if (updated.count !== 1) throw conflict();
        }
        if (!source.policy) {
          await tx.aiAutomationPolicy.create({ data: { id: row.policyId, ...access.scope, subjectId: row.subjectId, ...policyFields, revision: 1,
            validFrom: new Date(validFrom), expiresAt: new Date(policyExpiry), revokedAt: null, enabledBy: null, enabledAudience: null, enabledAt: null,
            counterDay: null, preparedCount: 0, lastPreparedAt: null } });
        } else if (policyChanged) {
          const updated = await tx.aiAutomationPolicy.updateMany({ where: { id: row.policyId, subjectId: row.subjectId, ...access.scope, revision: command.expectedPolicyRevision! },
            data: { ...policyFields, revision: { increment: 1 }, validFrom: new Date(validFrom), expiresAt: new Date(policyExpiry),
              revokedAt: policyRevoked ? source.policy.revokedAt ?? now : null, ...(policyFields.mode !== 'disabled' ? enabled : {}) } });
          if (updated.count !== 1) throw conflict();
        }
        const subject = await tx.aiAutomationSubject.findFirst({ where: { id: row.subjectId, ...access.scope } });
        const policy = await tx.aiAutomationPolicy.findFirst({ where: { id: row.policyId, subjectId: row.subjectId, ...access.scope } });
        if (!subject || !policy) throw unavailable();
        // A no-op save has its own current manager receipt, but must preserve the
        // original boundary and its author instead of signing that revision again.
        if (constraints && (policyChanged || !source.before.policy?.settings.constraints)) await recordOriginalAutomationPolicyBoundary(tx, { scopeId: access.scopeId,
          actorId: access.person.actorId, policy, subject, constraints });
        const outcome = parse(managementResult, { subject: { id: subject.id, authorizationRevision: subject.authorizationRevision, ...subjectConfiguration(subject), ...enabledProvenance(subject) },
          policy: { id: policy.id, subjectId: policy.subjectId, revision: policy.revision,
            ...await this.policySettings(policy, subject, tx), ...enabledProvenance(policy),
            counterDay: policy.counterDay?.toISOString() ?? null, preparedCount: policy.preparedCount, lastPreparedAt: policy.lastPreparedAt?.toISOString() ?? null } });
        const operation = await tx.aiAutomationPolicyManagementOperation.create({ data: { id: randomUUID(), ...access.scope, ...access.person, scopeId: access.scopeId,
          operationKey: row.operationKey, preparationId: row.id, subjectId: row.subjectId, policyId: row.policyId, changeHash: row.changeHash,
          result: outcome, resultHash: hash(outcome), grantId: grant.id, grantRevision: grant.revision, authorizationHash: grant.authorizationHash } });
        if ((await this.grant(access, 'commit', row.commitResourceHash, tx)).authorizationHash !== grant.authorizationHash) throw unavailable();
        return this.receipt(operation, row, access);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      acknowledged = true;
      await this.sameAccess(access, 'manage');
      return result;
    } catch (error) {
      if (error instanceof AutomationManagementError && !acknowledged) throw error;
      if (attempted || acknowledged) return { state: 'unknown' as const, operationKey: prepared.operationKey, preparationId: prepared.id,
        retryable: false as const, nextAction: 'read_operation' as const, ...semantics };
      throw unavailable();
    }
  }
}
