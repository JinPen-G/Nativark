import type { AiKnowledgePolicyPreparationTarget } from '@prisma/client';
import type { KnowledgeManagementAuthority, KnowledgePolicyReadDb } from './knowledge-policy-management-authority';
import { authorityFingerprint, managementFingerprint as hash, managementParse as parse, preparedTargetSpec,
  preparedUploadResource, lifecycleTargetSpec, revisionUploadTargetSpec, revisionUploadResource, type KnowledgeLifecycleTarget, KnowledgePolicyManagementError } from './knowledge-policy-management.validation';
import { draftInput, knowledgeRecordSchema, mutationInput, operationFingerprint, sameScope } from './knowledge-validation';
import { knowledgeUploadKey, knowledgeUploadRevisionSchema } from './human-knowledge-upload.service';
import type { KnowledgeAuthorizationRequest } from './knowledge.ports';

const denied = () => new KnowledgePolicyManagementError('unavailable');
export const targetSpecHash = (authority: KnowledgeManagementAuthority) => hash({ tenantId: authority.row.tenantId,
  workspaceId: authority.row.workspaceId, managerId: authority.row.managerId, targetActorId: authority.row.targetActorId,
  targetAudience: authority.row.targetAudience, spec: parse(preparedTargetSpec, authority.row.preparationTarget) });

export async function readPreparedKnowledgeTarget(db: KnowledgePolicyReadDb, authority: KnowledgeManagementAuthority, now: Date, bound = false) {
  const spec = parse(preparedTargetSpec, authority.row.preparationTarget);
  const row = await db.aiKnowledgePolicyPreparationTarget.findFirst({ where: { documentId: spec.upload.documentId } });
  if (!row || row.tenantId !== authority.row.tenantId || row.workspaceId !== authority.row.workspaceId || row.managerId !== authority.row.managerId
    || row.targetActorId !== authority.row.targetActorId || row.targetAudience !== authority.row.targetAudience
    || row.operationKey !== spec.operationKey || row.documentId !== spec.upload.documentId || row.specHash !== targetSpecHash(authority)
    || hash(row.specJson) !== hash(spec) || !(row.expiresAt instanceof Date) || row.expiresAt.getTime() !== Date.parse(spec.expiresAt)
    || row.expiresAt <= now || !['prepared', 'bound'].includes(row.status) || row.revision !== (row.status === 'prepared' ? 1 : 2)
    || bound && row.status !== 'bound') throw denied();
  const root = await db.aiKnowledgePolicyManagementAuthority.findFirst({ where: { id: row.authorityId, tenantId: row.tenantId, workspaceId: row.workspaceId } });
  if (!root || root.id !== row.authorityId || root.tenantId !== row.tenantId || root.workspaceId !== row.workspaceId || root.managerId !== row.managerId
    || root.targetActorId !== row.targetActorId || root.targetAudience !== row.targetAudience || root.domain !== 'knowledge' || root.action !== 'upload'
    || !root.enabled || root.revision !== row.authorityRevision || !(root.expiresAt instanceof Date) || root.expiresAt <= now
    || authorityFingerprint(root) !== row.authorizationHash || hash(root.preparationTarget) !== hash(spec)
    || hash(root.resource) !== hash(preparedUploadResource(spec))) throw denied();
  if (row.status === 'prepared' && (row.uploadSessionId !== null || row.attachmentId !== null || row.bindingHash !== null || row.boundAt !== null)) throw denied();
  if (row.status === 'bound') {
    if (!row.uploadSessionId || !row.attachmentId || !row.bindingHash || !(row.boundAt instanceof Date)) throw denied();
    const proof = await preparedKnowledgeUploadBinding(db, row, row.uploadSessionId);
    if (proof.attachmentId !== row.attachmentId || proof.bindingHash !== row.bindingHash) throw denied();
  }
  return { row, spec };
}

export async function preparedKnowledgeUploadBinding(db: KnowledgePolicyReadDb, target: AiKnowledgePolicyPreparationTarget, sessionId: string) {
  const spec = parse(preparedTargetSpec, target.specJson), expected = preparedUploadResource(spec).upload;
  const session = await db.fileUploadSession.findFirst({ where: { id: sessionId, tenantId: target.tenantId } });
  if (!session || session.id !== sessionId || session.tenantId !== target.tenantId || session.status !== 'completed'
    || session.idempotencyKey !== expected.idempotencyKey || !(session.completedAt instanceof Date) || !Number.isFinite(session.completedAt.getTime())
    || session.completedAt > target.expiresAt || session.completedAt < target.createdAt || !(session.expiresAt instanceof Date)
    || session.completedAt > session.expiresAt) throw denied();
  const asset = await db.fileAsset.findFirst({ where: { id: session.fileAssetId, tenantId: target.tenantId } });
  const metadata = asset?.metadata;
  if (!asset || asset.id !== session.fileAssetId || asset.tenantId !== target.tenantId || asset.businessModule !== 'ai-native'
    || asset.businessType !== 'ai_knowledge_document' || asset.businessId !== target.documentId || asset.uploadScene !== 'ai-knowledge'
    || asset.uploadedBy !== target.targetActorId || asset.status !== 'active' || asset.storageProvider === 'local_mock'
    || asset.storageProvider !== session.provider || asset.storageKey !== session.storageKey || asset.fileName !== expected.fileName
    || asset.mimeType !== expected.mimeType || asset.sizeBytes !== expected.sizeBytes || !metadata || Array.isArray(metadata) || typeof metadata !== 'object'
    || metadata.workspaceId !== target.workspaceId || metadata.knowledgeUploadVersion !== 1 || metadata.knowledgeRevision !== undefined) throw denied();
  const binding = { targetId: target.id, specHash: target.specHash, sessionId, attachmentId: asset.id, tenantId: target.tenantId,
    workspaceId: target.workspaceId, actorId: asset.uploadedBy, provider: asset.storageProvider, storageKey: asset.storageKey,
    upload: expected, completedAt: session.completedAt.toISOString() };
  return { attachmentId: asset.id, sessionId, bindingHash: hash(binding) };
}

export async function preparedKnowledgeResourceBasis(db: KnowledgePolicyReadDb, authority: KnowledgeManagementAuthority, now: Date) {
  const { row, spec } = await readPreparedKnowledgeTarget(db, authority, now, authority.row.action === 'create');
  if (authority.row.action === 'upload') {
    if (hash(authority.resource) !== hash(preparedUploadResource(spec))) throw denied();
    if (await db.aiKnowledgeDocument.findFirst({ where: { id: row.documentId }, select: { id: true } })) throw denied();
    return { targetId: row.id, specHash: row.specHash };
  }
  if (authority.row.action !== 'create' || !row.attachmentId) throw denied();
  const { resource } = authority;
  if ('attachmentId' in resource && resource.attachmentId !== row.attachmentId) throw denied();
  if ('documentId' in resource && (resource.documentId !== row.documentId || resource.documentVersion !== spec.document.documentVersion || resource.aclRevision !== 1)) throw denied();
  const occupied = await db.aiKnowledgeDocument.findFirst({ where: { id: row.documentId }, select: { id: true, tenantId: true, workspaceId: true } });
  if (occupied) {
    if (occupied.tenantId !== row.tenantId || occupied.workspaceId !== row.workspaceId) throw denied();
    const existing = await db.aiKnowledgeDocument.findFirst({ where: { id: row.documentId, tenantId: row.tenantId, workspaceId: row.workspaceId } });
    if (!existing) throw denied();
    const d = parse(knowledgeRecordSchema, existing.state).document;
    if (d.documentId !== row.documentId || d.documentVersion !== spec.document.documentVersion || d.attachmentId !== row.attachmentId
      || d.owner.actorKind !== 'user' || d.owner.actorId !== row.targetActorId || d.aclRevision !== 1 || d.publication === 'deleted'
      || !sameScope(d.scope, { kind: 'workspace', tenantId: row.tenantId, workspaceId: row.workspaceId })) throw denied();
  }
  return { targetId: row.id, specHash: row.specHash, bindingHash: row.bindingHash };
}

export async function assertPreparedKnowledgeCreation(db: KnowledgePolicyReadDb, authority: KnowledgeManagementAuthority, input: unknown, now: Date) {
  const { row, spec } = await readPreparedKnowledgeTarget(db, authority, now, true);
  const creation = parse(draftInput, input);
  const expected = { documentId: spec.upload.documentId, ...spec.document, attachmentId: row.attachmentId };
  if (hash(creation) !== hash(expected)) throw denied();
}

export function lifecycleCommand(target: KnowledgeLifecycleTarget): NonNullable<KnowledgeAuthorizationRequest['lifecycle']> {
  if (target.action === 'delete') return { action: 'delete', command: parse(mutationInput, {
    documentId: target.from.documentId, expectedRevision: target.from.revision, operationId: target.operationId }) };
  return { action: 'revise', expectedRevision: target.from.revision, command: parse(draftInput, {
    documentId: target.from.documentId, documentVersion: target.to.documentVersion, attachmentId: target.to.attachmentId,
    title: target.to.title, validFrom: target.to.validFrom, ...(target.to.validUntil ? { validUntil: target.to.validUntil } : {}),
    operationId: target.operationId }) };
}

/** Authorize the original version-specific upload against the current persisted
 * head. No placeholder document, mutable target reuse or default owner grant. */
export async function knowledgeRevisionUploadResourceBasis(db: KnowledgePolicyReadDb, authority: KnowledgeManagementAuthority, now: Date) {
  const target = parse(revisionUploadTargetSpec, authority.row.preparationTarget), { row } = authority;
  if (row.domain !== 'knowledge' || row.action !== 'upload' || hash(authority.resource) !== hash(revisionUploadResource(target))
    || !Number.isFinite(now.getTime()) || Date.parse(target.expiresAt) <= now.getTime()) throw denied();
  const where = { id: target.from.documentId, tenantId: row.tenantId, workspaceId: row.workspaceId };
  const stored = await db.aiKnowledgeDocument.findFirst({ where });
  if (!stored || stored.id !== where.id || stored.tenantId !== where.tenantId || stored.workspaceId !== where.workspaceId) throw denied();
  const state = parse(knowledgeRecordSchema, stored.state), d = state.document;
  if (stored.revision !== state.revision || stored.status !== d.publication || stored.title !== d.title || state.parseOperationId
    || state.revision !== target.from.revision || d.documentId !== where.id || d.documentVersion !== target.from.documentVersion
    || d.attachmentId !== target.from.attachmentId || d.aclRevision !== target.from.aclRevision || d.publication === 'deleted'
    || !sameScope(d.scope, { kind: 'workspace', ...{ tenantId: row.tenantId, workspaceId: row.workspaceId } })) throw denied();
  const grants = [];
  for (const [actorId, permission] of [[row.managerId, 'manage_policy'], [row.targetActorId, 'upload']]) {
    if (d.owner.actorKind === 'user' && d.owner.actorId === actorId) continue;
    const grant = await db.aiKnowledgeAcl.findFirst({ where: { documentId: d.documentId, subjectType: 'user', subjectId: actorId, permission } });
    if (!grant || grant.documentId !== d.documentId || grant.subjectType !== 'user' || grant.subjectId !== actorId || grant.permission !== permission) throw denied();
    grants.push({ id: grant.id, subjectId: actorId, permission });
  }
  if (await db.aiKnowledgeVersion.findFirst({ where: { documentId: where.id, contentHash: target.targetVersion }, select: { documentId: true } })) throw denied();
  if (hash(stored) !== hash(await db.aiKnowledgeDocument.findFirst({ where }))) throw denied();
  return { target, owner: d.owner, grants, uploadKey: revisionUploadResource(target).upload.idempotencyKey };
}

export function validateLifecycleResource(authority: { row: { domain: string; action: string }; resource: unknown }, target: KnowledgeLifecycleTarget) {
  const { row, resource } = authority, { revision: _revision, ...from } = target.from;
  if (row.domain !== 'knowledge' || ![target.action, 'read_metadata'].includes(row.action)) throw denied();
  const resources = [from];
  if (target.action === 'revise') {
    resources.push({ ...from, documentVersion: target.to.documentVersion, attachmentId: target.to.attachmentId });
    if (row.action === 'revise') resources.push({ ...from, attachmentId: target.to.attachmentId });
  }
  if (!resources.some(candidate => hash(candidate) === hash(resource))) throw denied();
}

async function successorAttachment(db: KnowledgePolicyReadDb, authority: KnowledgeManagementAuthority,
  target: Extract<KnowledgeLifecycleTarget, { action: 'revise' }>, now: Date) {
  const { row } = authority, expected = { documentVersion: target.from.documentVersion, expectedRevision: target.from.revision,
    aclRevision: target.from.aclRevision, targetVersion: target.to.documentVersion };
  const session = await db.fileUploadSession.findFirst({ where: { id: target.to.uploadSessionId, tenantId: row.tenantId } });
  const asset = await db.fileAsset.findFirst({ where: { id: target.to.attachmentId, tenantId: row.tenantId } });
  const metadata = asset?.metadata;
  if (!session || session.id !== target.to.uploadSessionId || session.tenantId !== row.tenantId
    || session.fileAssetId !== target.to.attachmentId || session.status !== 'completed'
    || session.idempotencyKey !== knowledgeUploadKey(target.from.documentId, target.to.documentVersion)
    || !(session.completedAt instanceof Date) || !Number.isFinite(session.completedAt.getTime())
    || !(session.expiresAt instanceof Date) || !Number.isFinite(session.expiresAt.getTime())
    || session.completedAt > session.expiresAt || session.completedAt > now
    || !asset || asset.id !== target.to.attachmentId || asset.tenantId !== row.tenantId || asset.status !== 'active'
    || asset.businessModule !== 'ai-native' || asset.businessType !== 'ai_knowledge_document'
    || asset.businessId !== target.from.documentId || asset.uploadScene !== 'ai-knowledge'
    || asset.uploadedBy !== row.targetActorId || asset.storageProvider === 'local_mock'
    || asset.storageProvider !== session.provider || asset.storageKey !== session.storageKey
    || !metadata || Array.isArray(metadata) || typeof metadata !== 'object'
    || metadata.workspaceId !== row.workspaceId || metadata.knowledgeUploadVersion !== 1
    || hash(parse(knowledgeUploadRevisionSchema, metadata.knowledgeRevision)) !== hash(expected)) throw denied();
  return hash({ sessionId: session.id, completedAt: session.completedAt.toISOString(), attachmentId: asset.id,
    storageKey: asset.storageKey, provider: asset.storageProvider, revision: expected });
}

export async function knowledgeLifecycleResourceBasis(db: KnowledgePolicyReadDb, authority: KnowledgeManagementAuthority, now: Date) {
  const { row } = authority, target = parse(lifecycleTargetSpec, row.preparationTarget);
  validateLifecycleResource(authority, target);
  if (!Number.isFinite(now.getTime()) || Date.parse(target.expiresAt) <= now.getTime()) throw denied();
  const scope = { kind: 'workspace' as const, tenantId: row.tenantId, workspaceId: row.workspaceId };
  const where = { id: target.from.documentId, tenantId: row.tenantId, workspaceId: row.workspaceId };
  const record = await db.aiKnowledgeDocument.findFirst({ where });
  if (!record || record.id !== where.id || record.tenantId !== where.tenantId || record.workspaceId !== where.workspaceId) throw denied();
  const state = parse(knowledgeRecordSchema, record.state), d = state.document;
  if (!sameScope(d.scope, scope) || record.revision !== state.revision || record.status !== d.publication
    || record.title !== d.title || d.documentId !== where.id || d.aclRevision !== target.from.aclRevision || state.parseOperationId) throw denied();
  const before = state.revision === target.from.revision && d.documentVersion === target.from.documentVersion
    && d.attachmentId === target.from.attachmentId && d.publication !== 'deleted';
  const after = state.revision === target.from.revision + 1 && state.indexJob?.operationId === `${target.operationId}:index`
    && state.indexJob.kind === 'remove' && state.indexJob.generation === state.revision
    && d.indexing === 'not_indexed' && (target.action === 'delete'
      ? d.documentVersion === target.from.documentVersion && d.attachmentId === target.from.attachmentId && d.publication === 'deleted'
      : d.documentVersion === target.to.documentVersion && d.attachmentId === target.to.attachmentId && d.publication === 'draft'
        && d.parsing === 'pending' && !state.failure && d.title === target.to.title
        && d.validFrom === target.to.validFrom && d.validUntil === target.to.validUntil);
  if (!before && !after) throw denied();
  const operation = lifecycleCommand(target);
  const expected = operationFingerprint({ scope, actor: { kind: 'user', userId: row.targetActorId }, audience: row.targetAudience as 'operator' | 'staff' },
    operation.action === 'revise' ? ['revise', operation.expectedRevision, operation.command] : ['delete', operation.command]);
  const receipt = await db.aiKnowledgeOperation.findFirst({ where: { tenantId: row.tenantId, workspaceId: row.workspaceId,
    documentId: where.id, operationId: target.operationId } });
  if (before && receipt || after && (!receipt || receipt.tenantId !== row.tenantId || receipt.workspaceId !== row.workspaceId
    || receipt.documentId !== where.id || receipt.operationId !== target.operationId || receipt.fingerprint !== expected)) throw denied();
  let attachmentBinding: string | undefined;
  if (target.action === 'revise') {
    attachmentBinding = await successorAttachment(db, authority, target, now);
    const version = await db.aiKnowledgeVersion.findFirst({ where: { documentId: where.id, contentHash: target.to.documentVersion },
      select: { documentId: true, contentHash: true } });
    if (before && version || after && (!version || version.documentId !== where.id || version.contentHash !== target.to.documentVersion)) throw denied();
  }
  const acl = [];
  for (const [actorId, permission] of [[row.managerId, 'manage_policy'], [row.targetActorId, row.action]]) {
    if (d.owner.actorKind === 'user' && d.owner.actorId === actorId) continue;
    const grant = await db.aiKnowledgeAcl.findFirst({ where: { documentId: d.documentId, subjectType: 'user', subjectId: actorId, permission } });
    if (!grant || grant.documentId !== d.documentId || grant.subjectType !== 'user' || grant.subjectId !== actorId || grant.permission !== permission) throw denied();
    acl.push({ id: grant.id, subjectId: actorId, permission });
  }
  if (hash(record) !== hash(await db.aiKnowledgeDocument.findFirst({ where }))) throw denied();
  return { target, owner: d.owner, acl, ...(attachmentBinding ? { attachmentBinding } : {}), phase: before ? 'before' as const : 'committed' as const };
}

export async function assertLifecycleConsumption(db: KnowledgePolicyReadDb, authority: KnowledgeManagementAuthority,
  request: KnowledgeAuthorizationRequest, now: Date) {
  const basis = await knowledgeLifecycleResourceBasis(db, authority, now), target = basis.target;
  if (request.action === 'read_metadata') {
    if (target.action === 'delete' && (basis.phase !== 'committed' || request.receiptOperationId !== target.operationId)) throw denied();
    return;
  }
  if (request.action !== target.action || hash(request.lifecycle) !== hash(lifecycleCommand(target))) throw denied();
}
