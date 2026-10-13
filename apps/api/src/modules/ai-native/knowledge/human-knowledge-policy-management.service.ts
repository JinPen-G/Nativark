import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AiKnowledgePolicyPreparation, type AiKnowledgePolicyManagementOperation } from '@prisma/client';
import { z } from 'zod';
import type { AuthService } from '../../auth/auth.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { TenantModelConfigurationAuthority } from '../tenant-model-config.authority';
import { knowledgeManagementAuthority, knowledgePolicyParticipants, knowledgePolicyResourceBasis, type KnowledgePolicyReadDb } from './knowledge-policy-management-authority';
import { readPreparedKnowledgeTarget, preparedKnowledgeUploadBinding, targetSpecHash } from './knowledge-policy-preparation-target';
import { KnowledgePolicyManagementError, managementParse as parse, managementFingerprint as hash, managementIdentityHash,
  preparedTargetSpec, authorityTargetSpec, lifecycleTargetSpec, preparedUploadResource, managementHash, policyChange, policySnapshot, policyWhere, policyKeyHash, preparationFingerprint, receiptSelection, commitSelection, type PolicyChange } from './knowledge-policy-management.validation';
import type { AiKnowledgePolicyManagementReceiptDraft, AiKnowledgePolicyManagementUnknownDraft } from '@rental-os/shared';

export type KnowledgePolicyManagementDependencies = {
  auth: Pick<AuthService, 'resolveAccessContext'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiTaskCredentialSource;
};
export type KnowledgePolicyManagementDb = KnowledgePolicyReadDb & Pick<PrismaClient, '$transaction'>;
type Access = Awaited<ReturnType<HumanKnowledgePolicyManagementService['access']>>;
const unavailable = () => new KnowledgePolicyManagementError('unavailable');
const conflict = () => new KnowledgePolicyManagementError('conflict');
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 };

export class HumanKnowledgePolicyManagementService {
  private readonly identity: AiTaskCurrentIdentityAuthority;
  private readonly original: TenantModelConfigurationAuthority;
  constructor(private readonly db: KnowledgePolicyManagementDb, input: KnowledgePolicyManagementDependencies,
    private readonly clock: () => Date = () => new Date()) {
    this.identity = new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, clock);
    this.original = new TenantModelConfigurationAuthority(input.guard, input.credentials, this.identity);
  }

  private async access(action: 'read' | 'manage') {
    const current = await this.identity.resolve();
    if (current.actor.kind !== 'user' || current.scope.kind !== 'workspace' || current.audience !== 'operator'
      || !('access' in current) || current.access.dataScope !== 'all' || current.access.locationScope.mode !== 'all') throw unavailable();
    const scope = { tenantId: current.scope.tenantId, workspaceId: current.scope.workspaceId };
    await this.original.authorize({ ...scope, actorId: current.actor.userId }, action);
    if (managementIdentityHash(await this.identity.resolve()) !== managementIdentityHash(current)) throw unavailable();
    return { scope, actorId: current.actor.userId, audience: 'operator' as const, permissions: [...current.access.permissions], identityHash: managementIdentityHash(current) };
  }
  private async sameAccess(before: Access, action: 'read' | 'manage') {
    if ((await this.access(action)).identityHash !== before.identityHash) throw unavailable();
  }
  private key(access: Access, operationKey: string) { return { ...access.scope, actorId: access.actorId, audience: access.audience, operationKey }; }
  private async authority(access: Access, id: string, db: KnowledgePolicyReadDb, live: boolean) {
    const authority = await knowledgeManagementAuthority(db, id, access.scope, this.clock(), live);
    if (authority.row.managerId !== access.actorId || authority.required.some(p => !access.permissions.includes(p))) throw unavailable();
    return authority;
  }
  private async source(command: PolicyChange, access: Access, db: KnowledgePolicyReadDb, live = true) {
    const authority = await this.authority(access, command.authorityId, db, live);
    if (!authority.operations.includes(command.action) || command.requiredPermissions.some(p => !access.permissions.includes(p) || !authority.allowed.includes(p))) throw unavailable();
    const closing = command.action === 'disable';
    const basis = await knowledgePolicyResourceBasis(db, authority, closing, this.clock());
    if (!closing && authority.row.preparationTarget != null && Date.parse(command.expiresAt) > Date.parse(parse(authorityTargetSpec, authority.row.preparationTarget).expiresAt)) throw unavailable();
    const row = await db.aiKnowledgeActionPolicy.findUnique({ where: policyWhere(authority.key) });
    if (row && (Object.entries(authority.key).some(([key, value]) => row[key as keyof typeof row] !== value)
      || hash(row.resource) !== hash(authority.resource))) throw unavailable();
    const before = row ? parse(policySnapshot, { revision: row.revision, enabled: row.enabled,
      requiredPermissions: row.requiredPermissions, expiresAt: row.expiresAt.toISOString() }) : null;
    if ((before?.revision ?? 0) !== command.expectedRevision) throw conflict();
    if (command.action === 'create_disabled' ? before !== null : before === null) throw conflict();
    if (command.action === 'update_disabled' && before?.enabled) throw conflict();
    if (command.action === 'enable' && (!before || before.enabled || hash(before.requiredPermissions) !== hash(command.requiredPermissions) || before.expiresAt !== command.expiresAt)) throw conflict();
    if (closing && (hash(before?.requiredPermissions) !== hash(command.requiredPermissions) || before?.expiresAt !== command.expiresAt)) throw conflict();
    if (live && !closing && (Date.parse(command.expiresAt) <= this.clock().getTime() || Date.parse(command.expiresAt) > authority.row.expiresAt.getTime()
      || Date.parse(command.expiresAt) > this.clock().getTime() + authority.row.maxPolicySeconds * 1000)) throw unavailable();
    return { authority, before, basisHash: hash(basis), sourceHash: hash({ key: authority.key, before, basis }), policyKeyHash: policyKeyHash(authority.key) };
  }

  private async prepared(access: Access, id: string, db: KnowledgePolicyReadDb = this.db) {
    const row = await db.aiKnowledgePolicyPreparation.findFirst({ where: { id, ...access.scope, actorId: access.actorId, audience: access.audience } });
    if (!row || row.id !== id || row.tenantId !== access.scope.tenantId || row.workspaceId !== access.scope.workspaceId
      || row.actorId !== access.actorId || row.audience !== access.audience) throw unavailable();
    const command = parse(policyChange, row.commandJson);
    if (row.operationKey !== command.operationKey || row.changeHash !== preparationFingerprint(row)
      || row.authorityId !== command.authorityId || row.expectedRevision !== command.expectedRevision
      || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())) throw conflict();
    const authority = await this.authority(access, row.authorityId, db, false);
    if (row.policyKeyHash !== policyKeyHash(authority.key)) throw conflict();
    return { row, command };
  }
  private receipt(row: AiKnowledgePolicyManagementOperation, prep: AiKnowledgePolicyPreparation): AiKnowledgePolicyManagementReceiptDraft {
    const result = parse(policySnapshot, row.resultJson), command = parse(policyChange, prep.commandJson);
    if (row.tenantId !== prep.tenantId || row.workspaceId !== prep.workspaceId || row.actorId !== prep.actorId || row.audience !== prep.audience
      || row.preparationId !== prep.id || row.operationKey !== prep.operationKey || row.policyKeyHash !== prep.policyKeyHash
      || row.changeHash !== prep.changeHash || row.resultHash !== hash(result) || row.resultRevision !== result.revision
      || result.revision !== prep.expectedRevision + 1 || result.enabled !== (command.action === 'enable')
      || hash(result.requiredPermissions) !== hash(command.requiredPermissions) || result.expiresAt !== command.expiresAt
      || row.authorityRevision !== prep.authorityRevision || row.authorizationHash !== prep.authorizationHash) throw conflict();
    return { state: 'observed', operationKey: row.operationKey, preparationId: prep.id, changeHash: row.changeHash,
      policyKeyHash: row.policyKeyHash, result, recordedAt: row.createdAt.toISOString(), retryable: false, executionPermission: false };
  }
  private unknown(command: Pick<PolicyChange, 'operationKey'> & { changeHash?: string }, nextAction: 'read_preparation' | 'read_operation', state: 'unknown' | 'not_observed' = 'unknown'): AiKnowledgePolicyManagementUnknownDraft {
    return { state, operationKey: command.operationKey, changeHash: command.changeHash, retryable: false, nextAction, executionPermission: false };
  }

  async prepareTarget(value: unknown) {
    const { authorityId } = parse(z.object({ authorityId: z.string().uuid() }).strict(), value), access = await this.access('manage');
    const authority = await this.authority(access, authorityId, this.db, true), spec = parse(preparedTargetSpec, authority.row.preparationTarget);
    if (authority.row.domain !== 'knowledge' || authority.row.action !== 'upload' || !authority.operations.includes('prepare_target')
      || Date.parse(spec.expiresAt) <= this.clock().getTime() || Date.parse(spec.expiresAt) > this.clock().getTime() + authority.row.maxPolicySeconds * 1000) throw unavailable();
    await knowledgePolicyParticipants(this.db, authority);
    const key = { ...access.scope, managerId: access.actorId, operationKey: spec.operationKey };
    if (await this.db.aiKnowledgePolicyPreparationTarget.findFirst({ where: key })) return this.target({ authorityId, operationKey: spec.operationKey });
    const specHash = targetSpecHash(authority);
    try {
      await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_knowledge_policy_management_authorities WHERE id = ${authorityId} FOR UPDATE`);
        const fresh = await this.authority(access, authorityId, tx, true);
        if (fresh.authorizationHash !== authority.authorizationHash) throw conflict();
        await knowledgePolicyParticipants(tx, fresh);
        if (await tx.aiKnowledgeDocument.findFirst({ where: { id: spec.upload.documentId }, select: { id: true } })
          || await tx.fileUploadSession.findFirst({ where: { tenantId: access.scope.tenantId, idempotencyKey: preparedUploadResource(spec).upload.idempotencyKey }, select: { id: true } })) throw conflict();
        await tx.aiKnowledgePolicyPreparationTarget.create({ data: { id: randomUUID(), ...key,
          targetActorId: authority.row.targetActorId, targetAudience: authority.row.targetAudience, documentId: spec.upload.documentId,
          specJson: json(spec), specHash, authorityId, authorityRevision: authority.row.revision, authorizationHash: authority.authorizationHash,
          revision: 1, status: 'prepared', expiresAt: new Date(spec.expiresAt), uploadSessionId: null, attachmentId: null, bindingHash: null, boundAt: null } });
        await this.sameAccess(access, 'manage');
      }, options);
    } catch (error) {
      if (error instanceof KnowledgePolicyManagementError) throw error;
      return { state: 'unknown' as const, operationKey: spec.operationKey, specHash, retryable: false as const, nextAction: 'read_target' as const };
    }
    return this.target({ authorityId, operationKey: spec.operationKey });
  }

  async target(value: unknown) {
    const input = parse(z.object({ authorityId: z.string().uuid(), operationKey: receiptSelection.shape.operationKey, specHash: managementHash.optional() }).strict(), value), access = await this.access('read');
    const authority = await this.authority(access, input.authorityId, this.db, true), spec = parse(preparedTargetSpec, authority.row.preparationTarget);
    if (spec.operationKey !== input.operationKey || input.specHash && input.specHash !== targetSpecHash(authority)) throw conflict();
    const found = await this.db.aiKnowledgePolicyPreparationTarget.findFirst({ where: { ...access.scope, managerId: access.actorId, operationKey: spec.operationKey } });
    if (!found) { await this.sameAccess(access, 'read'); return { state: 'not_observed' as const, operationKey: spec.operationKey, retryable: false as const }; }
    const { row } = await readPreparedKnowledgeTarget(this.db, authority, this.clock());
    await this.sameAccess(access, 'read');
    return { state: row.status === 'bound' ? 'bound' as const : 'prepared' as const, targetId: row.id, operationKey: row.operationKey,
      revision: row.revision, specHash: row.specHash, specification: spec, expiresAt: row.expiresAt.toISOString(),
      attachmentId: row.attachmentId, uploadSessionId: row.uploadSessionId, executionPermission: false as const };
  }

  async bindTarget(value: unknown) {
    const input = parse(z.object({ authorityId: z.string().uuid(), operationKey: receiptSelection.shape.operationKey, sessionId: z.string().min(1).max(128), expectedRevision: z.literal(1), confirm: z.literal('bind_knowledge_upload') }).strict(), value);
    const access = await this.access('manage'), authority = await this.authority(access, input.authorityId, this.db, true);
    if (authority.row.domain !== 'knowledge' || authority.row.action !== 'upload' || !authority.operations.includes('bind_target')) throw unavailable();
    await knowledgePolicyParticipants(this.db, authority);
    const { row } = await readPreparedKnowledgeTarget(this.db, authority, this.clock());
    if (row.authorityId !== input.authorityId) throw conflict();
    if (input.operationKey !== row.operationKey) throw conflict();
    if (row.status === 'bound') {
      if (row.uploadSessionId !== input.sessionId) throw conflict();
      return this.target({ authorityId: input.authorityId, operationKey: row.operationKey });
    }
    const binding = await preparedKnowledgeUploadBinding(this.db, row, input.sessionId);
    try {
      await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_knowledge_policy_management_authorities WHERE id = ${input.authorityId} FOR UPDATE`);
        const fresh = await this.authority(access, input.authorityId, tx, true);
        if (fresh.authorizationHash !== authority.authorizationHash) throw conflict();
        await knowledgePolicyParticipants(tx, fresh);
        const current = await readPreparedKnowledgeTarget(tx, fresh, this.clock());
        if (current.row.revision !== input.expectedRevision || hash(await preparedKnowledgeUploadBinding(tx, current.row, input.sessionId)) !== hash(binding)) throw conflict();
        const changed = await tx.aiKnowledgePolicyPreparationTarget.updateMany({ where: { id: row.id, ...access.scope, revision: 1, status: 'prepared', specHash: row.specHash },
          data: { status: 'bound', revision: 2, uploadSessionId: binding.sessionId, attachmentId: binding.attachmentId, bindingHash: binding.bindingHash, boundAt: this.clock() } });
        if (changed.count !== 1) throw conflict();
        await readPreparedKnowledgeTarget(tx, fresh, this.clock(), true);
        await this.sameAccess(access, 'manage');
      }, options);
    } catch (error) {
      if (error instanceof KnowledgePolicyManagementError) throw error;
      return { state: 'unknown' as const, operationKey: row.operationKey, specHash: row.specHash, retryable: false as const, nextAction: 'read_target' as const };
    }
    return this.target({ authorityId: input.authorityId, operationKey: row.operationKey });
  }

  async read(value: unknown) {
    const { authorityId } = parse(z.object({ authorityId: z.string().uuid() }).strict(), value), access = await this.access('read');
    const authority = await this.authority(access, authorityId, this.db, false);
    const row = await this.db.aiKnowledgeActionPolicy.findUnique({ where: policyWhere(authority.key) });
    if (row && (Object.entries(authority.key).some(([key, v]) => row[key as keyof typeof row] !== v) || hash(row.resource) !== hash(authority.resource))) throw unavailable();
    const result = row ? parse(policySnapshot, { revision: row.revision, enabled: row.enabled, requiredPermissions: row.requiredPermissions, expiresAt: row.expiresAt.toISOString() }) : null;
    await this.sameAccess(access, 'read');
    return { state: result ? 'configured' as const : 'not_configured' as const, authorityId, policyKeyHash: policyKeyHash(authority.key),
      target: authority.key, resource: authority.resource, result, executionPermission: false as const };
  }

  async prepare(value: unknown) {
    const command = parse(policyChange, value), access = await this.access('manage');
    const key = this.key(access, command.operationKey);
    const existing = await this.db.aiKnowledgePolicyPreparation.findFirst({ where: key });
    if (existing) {
      const { command: original } = await this.prepared(access, existing.id);
      if (hash(original) !== hash(command)) throw conflict();
      return this.preparation({ operationKey: command.operationKey, changeHash: existing.changeHash });
    }
    const source = await this.source(command, access, this.db), id = randomUUID();
    const expiresAt = new Date(Math.min(this.clock().getTime() + 600000, source.authority.row.expiresAt.getTime(),
      command.action === 'disable' ? Infinity : Date.parse(command.expiresAt)));
    const evidence = { ...key, commandJson: command, beforeJson: source.before, sourceHash: source.sourceHash,
      policyKeyHash: source.policyKeyHash, authorizationHash: source.authority.authorizationHash, authorityRevision: source.authority.row.revision, expiresAt };
    const changeHash = preparationFingerprint(evidence);
    try {
      await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_knowledge_policy_management_authorities WHERE id = ${command.authorityId} FOR UPDATE`);
        const fresh = await this.source(command, access, tx);
        if (fresh.sourceHash !== source.sourceHash || fresh.authority.authorizationHash !== source.authority.authorizationHash) throw conflict();
        await this.sameAccess(access, 'manage');
        await tx.aiKnowledgePolicyPreparation.create({ data: { id, ...key, policyKeyHash: source.policyKeyHash, commandJson: json(command),
          beforeJson: source.before ? json(source.before) : Prisma.JsonNull, commitSlot: null, expectedRevision: command.expectedRevision,
          changeHash, sourceHash: source.sourceHash, authorityId: command.authorityId, authorityRevision: source.authority.row.revision,
          authorizationHash: source.authority.authorizationHash, expiresAt } });
        await this.sameAccess(access, 'manage');
      }, options);
    } catch (error) {
      if (error instanceof KnowledgePolicyManagementError) throw error;
      return this.unknown({ operationKey: command.operationKey, changeHash }, 'read_preparation');
    }
    return this.preparation({ operationKey: command.operationKey, changeHash });
  }

  async preparation(value: unknown) {
    const selected = parse(receiptSelection.extend({ changeHash: receiptSelection.shape.changeHash.optional() }), value), access = await this.access('read');
    const found = await this.db.aiKnowledgePolicyPreparation.findFirst({ where: this.key(access, selected.operationKey) });
    if (!found) { await this.sameAccess(access, 'read'); return this.unknown(selected, 'read_preparation', 'not_observed'); }
    const { row, command } = await this.prepared(access, found.id);
    if (selected.changeHash && row.changeHash !== selected.changeHash || row.operationKey !== selected.operationKey) throw conflict();
    const operation = await this.db.aiKnowledgePolicyManagementOperation.findFirst({ where: this.key(access, selected.operationKey) });
    if (operation) { const result = this.receipt(operation, row); await this.sameAccess(access, 'read'); return result; }
    if (row.commitSlot) { await this.sameAccess(access, 'read'); return this.unknown(selected, 'read_operation'); }
    let state: 'prepared' | 'expired' | 'stale' = row.expiresAt <= this.clock() ? 'expired' : 'prepared';
    let lifecycleTarget: z.infer<typeof lifecycleTargetSpec> | undefined;
    try {
      const fresh = await this.source(command, access, this.db);
      if (fresh.sourceHash !== row.sourceHash || fresh.authority.authorizationHash !== row.authorizationHash) state = 'stale';
      const target = lifecycleTargetSpec.safeParse(fresh.authority.row.preparationTarget);
      if (state === 'prepared' && target.success) lifecycleTarget = target.data;
    } catch (error) { if (error instanceof KnowledgePolicyManagementError) state = 'stale'; else throw error; }
    await this.sameAccess(access, 'read');
    return { state, preparationId: row.id, operationKey: row.operationKey, changeHash: row.changeHash, policyKeyHash: row.policyKeyHash,
      before: row.beforeJson, proposal: command, ...(lifecycleTarget ? { lifecycleTarget } : {}),
      expiresAt: row.expiresAt.toISOString(), executionPermission: false as const };
  }

  async reviewLifecycleTarget(value: unknown) {
    const selected = parse(receiptSelection, value), access = await this.access('read');
    const row = await this.db.aiKnowledgePolicyPreparation.findFirst({ where: this.key(access, selected.operationKey) });
    if (!row || row.tenantId !== access.scope.tenantId || row.workspaceId !== access.scope.workspaceId
      || row.actorId !== access.actorId || row.audience !== access.audience || row.operationKey !== selected.operationKey
      || row.changeHash !== selected.changeHash || row.changeHash !== preparationFingerprint(row)) throw conflict();
    const command = parse(policyChange, row.commandJson);
    if (command.authorityId !== row.authorityId || command.expectedRevision !== row.expectedRevision || command.operationKey !== row.operationKey) throw conflict();
    let result: { state: 'current'; target: z.infer<typeof lifecycleTargetSpec> } | { state: 'unavailable' | 'not_applicable' } = { state: 'unavailable' };
    try {
      const authority = await this.authority(access, row.authorityId, this.db, true);
      if (authority.authorizationHash !== row.authorizationHash || authority.row.revision !== row.authorityRevision
        || policyKeyHash(authority.key) !== row.policyKeyHash) throw unavailable();
      const target = lifecycleTargetSpec.safeParse(authority.row.preparationTarget);
      if (target.success) {
        const basis = await knowledgePolicyResourceBasis(this.db, authority, false, this.clock());
        const fresh = await this.authority(access, row.authorityId, this.db, true);
        if (fresh.authorizationHash !== row.authorizationHash
          || hash(await knowledgePolicyResourceBasis(this.db, fresh, false, this.clock())) !== hash(basis)) throw unavailable();
        result = { state: 'current', target: target.data };
      } else result = { state: 'not_applicable' };
    } catch { result = { state: 'unavailable' }; }
    await this.sameAccess(access, 'read');
    return result;
  }

  async operation(value: unknown) {
    const selected = parse(receiptSelection, value), access = await this.access('read');
    let operation: AiKnowledgePolicyManagementOperation | null;
    try { operation = await this.db.aiKnowledgePolicyManagementOperation.findFirst({ where: this.key(access, selected.operationKey) }); }
    catch { await this.sameAccess(access, 'read'); return this.unknown(selected, 'read_operation'); }
    if (!operation) { await this.sameAccess(access, 'read'); return this.unknown(selected, 'read_operation', 'not_observed'); }
    const { row } = await this.prepared(access, operation.preparationId);
    if (row.changeHash !== selected.changeHash || row.operationKey !== selected.operationKey) throw conflict();
    const result = this.receipt(operation, row);
    await this.sameAccess(access, 'read');
    return result;
  }

  async commit(value: unknown) {
    const selected = parse(commitSelection, value), access = await this.access('manage');
    const { row: prepared, command } = await this.prepared(access, selected.preparationId);
    if (prepared.changeHash !== selected.changeHash) throw conflict();
    const selection = { operationKey: prepared.operationKey, changeHash: prepared.changeHash }, key = this.key(access, prepared.operationKey);
    const existing = await this.db.aiKnowledgePolicyManagementOperation.findFirst({ where: key });
    if (existing) { const result = this.receipt(existing, prepared); await this.sameAccess(access, 'manage'); return result; }
    if (prepared.commitSlot) return this.unknown(selection, 'read_operation');
    const source = await this.source(command, access, this.db);
    if (prepared.expiresAt <= this.clock() || source.sourceHash !== prepared.sourceHash
      || source.authority.row.revision !== prepared.authorityRevision || source.authority.authorizationHash !== prepared.authorizationHash) throw conflict();
    // A durable slot fences uncertain commits, including retries under a different operation key.
    const commitSlot = hash({ policyKeyHash: prepared.policyKeyHash, expectedRevision: prepared.expectedRevision });
    try {
      const claimed = await this.db.aiKnowledgePolicyPreparation.updateMany({ where: { id: prepared.id, ...key, commitSlot: null }, data: { commitSlot } });
      if (claimed.count !== 1) return this.unknown(selection, 'read_operation');
    } catch {
      const original = await this.db.aiKnowledgePolicyPreparation.findFirst({ where: { commitSlot, ...access.scope, actorId: access.actorId, audience: access.audience } }).catch(() => null);
      await this.sameAccess(access, 'manage');
      return this.unknown(original ? { operationKey: original.operationKey, changeHash: original.changeHash } : selection, 'read_operation');
    }
    try {
      const result = await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_knowledge_policy_preparations WHERE id = ${prepared.id} FOR UPDATE`);
        const { row } = await this.prepared(access, prepared.id, tx);
        if (row.commitSlot !== commitSlot || row.expiresAt <= this.clock()) throw conflict();
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_knowledge_policy_management_authorities WHERE id = ${row.authorityId} FOR UPDATE`);
        const fresh = await this.source(command, access, tx);
        if (fresh.sourceHash !== row.sourceHash || fresh.authority.authorizationHash !== row.authorizationHash || fresh.authority.row.revision !== row.authorityRevision) throw conflict();
        await this.sameAccess(access, 'manage');
        const outcome = parse(policySnapshot, { revision: row.expectedRevision + 1, enabled: command.action === 'enable',
          requiredPermissions: command.requiredPermissions, expiresAt: command.expiresAt });
        const data = { ...fresh.authority.key, revision: outcome.revision, enabled: outcome.enabled,
          requiredPermissions: json(outcome.requiredPermissions), resource: json(fresh.authority.resource), expiresAt: new Date(outcome.expiresAt) };
        if (command.action === 'create_disabled') await tx.aiKnowledgeActionPolicy.create({ data });
        else {
          const changed = await tx.aiKnowledgeActionPolicy.updateMany({ where: { ...fresh.authority.key, revision: row.expectedRevision }, data });
          if (changed.count !== 1) throw conflict();
        }
        const receipt = await tx.aiKnowledgePolicyManagementOperation.create({ data: { id: randomUUID(), ...key, preparationId: row.id,
          policyKeyHash: row.policyKeyHash, resultRevision: outcome.revision, resultJson: json(outcome), resultHash: hash(outcome), changeHash: row.changeHash,
          authorityRevision: row.authorityRevision, authorizationHash: row.authorizationHash } });
        if ((await this.authority(access, row.authorityId, tx, true)).authorizationHash !== row.authorizationHash) throw unavailable();
        if (hash(await knowledgePolicyResourceBasis(tx, fresh.authority, command.action === 'disable', this.clock())) !== fresh.basisHash) throw conflict();
        await this.sameAccess(access, 'manage');
        return this.receipt(receipt, row);
      }, options);
      await this.sameAccess(access, 'manage');
      return result;
    } catch {
      return this.unknown(selection, 'read_operation');
    }
  }
}
