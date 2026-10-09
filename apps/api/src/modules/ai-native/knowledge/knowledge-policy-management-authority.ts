import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { AiKnowledgeActionPolicy, AiKnowledgePolicyManagementAuthority, PrismaClient } from '@prisma/client';
import { knowledgeRecordSchema, memoryDraftSchema, sameScope } from './knowledge-validation';
import { AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION } from '../../../../../../packages/shared/src/ai-knowledge-policy-management-draft';
import { preparedKnowledgeResourceBasis } from './knowledge-policy-preparation-target';
import { canonicalPolicyResource, managementActions, managementFingerprint as hash, managementParse as parse,
  permissions, policyKey, policyKeyHash, policyChange, policySnapshot, preparationFingerprint, originalResourceKey, revision,
  preparedTargetSpec, preparedUploadResource, authorityFingerprint, KnowledgePolicyManagementError } from './knowledge-policy-management.validation';

export type KnowledgePolicyReadDb = Pick<PrismaClient, 'aiKnowledgeActionPolicy' | 'aiKnowledgePolicyManagementAuthority'
  | 'aiKnowledgePolicyPreparation' | 'aiKnowledgePolicyManagementOperation' | 'businessWorkspace' | 'user' | 'workspaceMember'
  | 'aiKnowledgeDocument' | 'aiKnowledgeAcl' | 'aiStructuredMemory' | 'aiKnowledgePolicyPreparationTarget' | 'fileAsset' | 'fileUploadSession'>;
export type ManagementScope = { tenantId: string; workspaceId: string };
const denied = () => new KnowledgePolicyManagementError('unavailable');

export function validateKnowledgeManagementAuthority(row: AiKnowledgePolicyManagementAuthority, now: Date, live = true) {
  parse(z.string().uuid(), row.id); parse(revision, row.revision);
  for (const value of [row.tenantId, row.workspaceId, row.managerId, row.targetActorId, row.basisRef, row.basisVersion])
    parse(z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u), value);
  parse(z.enum(['operator', 'staff']), row.targetAudience);
  if (row.basisVersion !== AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION) throw denied();
  const resource = canonicalPolicyResource(row.domain, row.action, row.resource);
  const required = parse(permissions, row.requiredPermissions), allowed = parse(permissions, row.allowedPermissions);
  const operations = parse(managementActions, row.allowedOperations);
  parse(z.number().int().min(1).max(90 * 86400), row.maxPolicySeconds);
  if (row.resourceKey !== originalResourceKey(resource) || !isDeepStrictEqual(resource, row.resource)
    || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())
    || live && (!row.enabled || row.expiresAt <= now)) throw denied();
  if ('owner' in resource && resource.owner?.actorId !== row.targetActorId) throw denied();
  if (row.preparationTarget != null) {
    const target = parse(preparedTargetSpec, row.preparationTarget);
    if (row.domain !== 'knowledge' || !['upload', 'create'].includes(row.action) || Date.parse(target.expiresAt) > row.expiresAt.getTime()
      || row.action === 'upload' && hash(resource) !== hash(preparedUploadResource(target))) throw denied();
  } else if (row.domain === 'knowledge' && ['upload', 'create'].includes(row.action)) throw denied();
  return { row, key: policyKey(row), resource, required, allowed, operations, authorizationHash: authorityFingerprint(row) };
}
export type KnowledgeManagementAuthority = ReturnType<typeof validateKnowledgeManagementAuthority>;

export async function knowledgeManagementAuthority(db: KnowledgePolicyReadDb, id: string, scope: ManagementScope, now: Date, live = true) {
  const row = await db.aiKnowledgePolicyManagementAuthority.findFirst({ where: { id, ...scope } });
  if (!row) throw new KnowledgePolicyManagementError('trusted_authority_missing');
  if (row.id !== id || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId) throw denied();
  return validateKnowledgeManagementAuthority(row, now, live);
}

export async function knowledgePolicyParticipants(db: KnowledgePolicyReadDb, authority: KnowledgeManagementAuthority, closing = false) {
  const { row } = authority, scope = { tenantId: row.tenantId, workspaceId: row.workspaceId };
  const workspace = await db.businessWorkspace.findFirst({ where: { id: scope.workspaceId, tenantId: scope.tenantId, status: 'ACTIVE' }, select: { id: true, tenantId: true, status: true } });
  if (!workspace || workspace.id !== scope.workspaceId || workspace.tenantId !== scope.tenantId || workspace.status !== 'ACTIVE') throw denied();
  if (closing) return scope;
  for (const actorId of new Set([row.managerId, row.targetActorId])) {
    const user = await db.user.findFirst({ where: { id: actorId, tenantId: scope.tenantId, isActive: true }, select: { id: true, tenantId: true, isActive: true, isSaasAdmin: true } });
    const member = await db.workspaceMember.findFirst({ where: { ...scope, userId: actorId, isActive: true }, select: { tenantId: true, workspaceId: true, userId: true, isActive: true } });
    if (!user || user.id !== actorId || user.tenantId !== scope.tenantId || !user.isActive || user.isSaasAdmin
      || !member || member.userId !== actorId || member.tenantId !== scope.tenantId || member.workspaceId !== scope.workspaceId || !member.isActive) throw denied();
  }
  return scope;
}

export async function knowledgePolicyResourceBasis(db: KnowledgePolicyReadDb, authority: KnowledgeManagementAuthority, closing = false, now = new Date()) {
  const scope = await knowledgePolicyParticipants(db, authority, closing), { row, resource } = authority;
  if (closing) return { closing: true, key: authority.key };
  if (row.domain === 'knowledge' && ['upload', 'create'].includes(row.action)) return preparedKnowledgeResourceBasis(db, authority, now);
  if ('documentId' in resource && resource.documentId) {
    const document = await db.aiKnowledgeDocument.findFirst({ where: { ...scope, id: resource.documentId } });
    if (!document || document.id !== resource.documentId || document.tenantId !== scope.tenantId || document.workspaceId !== scope.workspaceId) throw denied();
    const state = parse(knowledgeRecordSchema, document.state), d = state.document;
    if (document.revision !== state.revision || document.status !== d.publication || document.title !== d.title
      || !sameScope(d.scope, { kind: 'workspace', ...scope }) || d.publication === 'deleted'
      || d.documentId !== resource.documentId || d.documentVersion !== resource.documentVersion
      || d.attachmentId !== resource.attachmentId || d.aclRevision !== resource.aclRevision) throw denied();
    const acl = [];
    for (const [actorId, permission] of [[row.managerId, 'manage_policy'], [row.targetActorId, row.action]]) {
      if (d.owner.actorKind === 'user' && d.owner.actorId === actorId) continue;
      const entry = await db.aiKnowledgeAcl.findFirst({ where: { documentId: d.documentId, subjectType: 'user', subjectId: actorId, permission } });
      if (!entry || entry.documentId !== d.documentId || entry.subjectType !== 'user' || entry.subjectId !== actorId || entry.permission !== permission) throw denied();
      acl.push({ id: entry.id, subjectId: actorId, permission });
    }
    return { documentId: d.documentId, documentVersion: d.documentVersion, attachmentId: d.attachmentId, aclRevision: d.aclRevision,
      owner: d.owner, acl };
  }
  if ('memoryId' in resource && resource.memoryId && resource.owner) {
    const memory = await db.aiStructuredMemory.findFirst({ where: { ...scope, id: resource.memoryId, ownerKind: 'user', ownerId: row.targetActorId } });
    // The original writer reads its result before returning; only its exact first/next revision may be reserved.
    const slot = { memoryId: resource.memoryId, revision: resource.revision, aclRevision: resource.aclRevision, owner: resource.owner };
    if (!memory && resource.revision === 1 && resource.aclRevision === 1 && ['propose', 'read'].includes(row.action)) return slot;
    if (!memory || memory.id !== resource.memoryId || memory.tenantId !== scope.tenantId || memory.workspaceId !== scope.workspaceId) throw denied();
    const state = parse(memoryDraftSchema, memory.state);
    const versionMatches = state.revision === resource.revision || row.action === 'read' && state.revision + 1 === resource.revision;
    if (state.memoryId !== resource.memoryId || !versionMatches || state.aclRevision !== resource.aclRevision
      || !sameScope(state.scope, { kind: 'workspace', ...scope }) || !isDeepStrictEqual(state.owner, resource.owner)
      || memory.ownerKind !== 'user' || memory.ownerId !== row.targetActorId || memory.subjectType !== 'user' || memory.subjectId !== row.targetActorId
      || memory.revision !== state.revision || memory.aclRevision !== state.aclRevision || memory.status !== state.status || state.status === 'deleted') throw denied();
    return slot;
  }
  return { scope, targetActorId: row.targetActorId, resource };
}

export async function managedKnowledgePolicyCurrent(db: KnowledgePolicyReadDb, row: AiKnowledgeActionPolicy, now: Date) {
  const key = { tenantId: row.tenantId, workspaceId: row.workspaceId, actorKind: row.actorKind, actorId: row.actorId,
    audience: row.audience, domain: row.domain, action: row.action, resourceKey: row.resourceKey };
  const operation = await db.aiKnowledgePolicyManagementOperation.findFirst({ where: { policyKeyHash: policyKeyHash(key) }, orderBy: { resultRevision: 'desc' } });
  // Unmanaged rows remain the original server-provisioned policy path.
  if (!operation) return;
  const prep = await db.aiKnowledgePolicyPreparation.findFirst({ where: { id: operation.preparationId, tenantId: row.tenantId, workspaceId: row.workspaceId } });
  if (!prep || prep.id !== operation.preparationId || prep.tenantId !== row.tenantId || prep.workspaceId !== row.workspaceId
    || operation.tenantId !== row.tenantId || operation.workspaceId !== row.workspaceId || operation.policyKeyHash !== policyKeyHash(key)
    || prep.policyKeyHash !== operation.policyKeyHash || prep.changeHash !== operation.changeHash || prep.operationKey !== operation.operationKey
    || prep.actorId !== operation.actorId || prep.audience !== operation.audience || operation.resultRevision !== row.revision) throw denied();
  const authority = await knowledgeManagementAuthority(db, prep.authorityId, { tenantId: row.tenantId, workspaceId: row.workspaceId }, now);
  const command = parse(policyChange, prep.commandJson), result = parse(policySnapshot, operation.resultJson);
  if (hash(authority.key) !== hash(key) || authority.row.managerId !== prep.actorId || authority.row.revision !== prep.authorityRevision
    || operation.authorityRevision !== prep.authorityRevision || operation.authorizationHash !== prep.authorizationHash
    || authority.authorizationHash !== prep.authorizationHash || command.action !== 'enable' || result.enabled !== true
    || command.authorityId !== prep.authorityId || command.operationKey !== prep.operationKey || command.expectedRevision !== prep.expectedRevision
    || prep.changeHash !== preparationFingerprint(prep)
    || operation.resultHash !== hash(result) || result.revision !== row.revision || result.revision !== prep.expectedRevision + 1
    || result.expiresAt !== row.expiresAt.toISOString() || hash(result.requiredPermissions) !== hash(row.requiredPermissions)
    || hash(command.requiredPermissions) !== hash(result.requiredPermissions) || command.expiresAt !== result.expiresAt
    || result.requiredPermissions.some(p => !authority.allowed.includes(p)) || row.expiresAt > authority.row.expiresAt) throw denied();
  await knowledgePolicyResourceBasis(db, authority, false, now);
  return authority;
}
