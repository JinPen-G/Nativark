import type { AiKnowledgePolicyPreparationTarget } from '@prisma/client';
import type { KnowledgeManagementAuthority, KnowledgePolicyReadDb } from './knowledge-policy-management-authority';
import { authorityFingerprint, managementFingerprint as hash, managementParse as parse, preparedTargetSpec,
  preparedUploadResource, KnowledgePolicyManagementError } from './knowledge-policy-management.validation';
import { draftInput, knowledgeRecordSchema, sameScope } from './knowledge-validation';

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
