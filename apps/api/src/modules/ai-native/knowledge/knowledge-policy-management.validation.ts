import { z } from 'zod';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { fingerprint, id } from './knowledge-validation';
import { knowledgeUploadInput, knowledgeUploadRevisionSchema, knowledgeUploadKey } from './human-knowledge-upload.service';
import { AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION, type AiKnowledgePolicyChangeDraft } from '../../../../../../packages/shared/src/ai-knowledge-policy-management-draft';

export class KnowledgePolicyManagementError extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable' | 'conflict' | 'trusted_authority_missing') { super(code); }
}
export function managementParse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new KnowledgePolicyManagementError('invalid_input');
  return parsed.data;
}
export const managementHash = z.string().regex(/^[a-f0-9]{64}$/u);
export const revision = z.number().int().min(1).max(4294967294);
const permission = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,190}$/u);
export const permissions = z.array(permission).min(1).max(64).refine(p => new Set(p).size === p.length);
export const managementActions = z.array(z.enum(['create_disabled', 'update_disabled', 'enable', 'disable', 'prepare_target', 'bind_target'])).min(1).max(6).refine(p => new Set(p).size === p.length);
export const policyChange: z.ZodType<AiKnowledgePolicyChangeDraft> = z.object({ version: z.literal(AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION), authorityId: z.string().uuid(),
  operationKey: id, expectedRevision: z.number().int().min(0).max(4294967293), action: z.enum(['create_disabled', 'update_disabled', 'enable', 'disable']),
  requiredPermissions: permissions, expiresAt: z.string().datetime({ offset: true }).transform(v => new Date(v).toISOString()) }).strict();
export const receiptSelection = z.object({ operationKey: id, changeHash: managementHash }).strict();
export const commitSelection = z.object({ preparationId: z.string().uuid(), changeHash: managementHash, confirm: z.literal('apply_knowledge_policy_change') }).strict();
export const policySnapshot = z.object({ revision, enabled: z.boolean(), requiredPermissions: permissions, expiresAt: z.string().datetime({ offset: true }) }).strict();
const owner = z.object({ actorKind: z.literal('user'), actorId: id }).strict();
export const preparedTargetSpec = z.object({ version: z.literal('knowledge-prepared-target-1'), operationKey: id,
  upload: knowledgeUploadInput.extend({ documentId: id.max(36) }).strict(),
  document: z.object({ documentVersion: id, operationId: id, title: z.string().min(1).max(256),
    validFrom: z.string().datetime({ offset: true }), validUntil: z.string().datetime({ offset: true }).optional() }).strict(),
  expiresAt: z.string().datetime({ offset: true }) }).strict().refine(v => !v.document.validUntil || Date.parse(v.document.validUntil) > Date.parse(v.document.validFrom));
export const preparedUploadResource = (spec: z.infer<typeof preparedTargetSpec>) => ({ upload: { documentId: spec.upload.documentId,
  idempotencyKey: knowledgeUploadKey(spec.upload.documentId), fileName: spec.upload.fileName, mimeType: spec.upload.mimeType, sizeBytes: spec.upload.sizeBytes } });
export const authorityFingerprint = (row: { expiresAt: Date; preparationTarget?: unknown; createdAt?: unknown; updatedAt?: unknown }) => {
  const { preparationTarget, createdAt: _created, updatedAt: _updated, ...base } = row;
  return requestFingerprint({ ...base, expiresAt: row.expiresAt.toISOString(), ...(preparationTarget == null ? {} : { preparationTarget }) });
};
export const knowledgePolicyActions = z.enum(['upload', 'create', 'read_metadata', 'parse', 'publish', 'withdraw', 'delete', 'revise', 'search', 'read_body', 'snippet', 'resolve_source', 'download', 'index', 'change_acl']);
export const memoryPolicyActions = z.enum(['read', 'propose', 'modify', 'confirm', 'delete']);
export const documentResource = z.object({ documentId: id, documentVersion: id, attachmentId: id, aclRevision: revision }).strict();
const lifecycleHead = documentResource.extend({ revision: revision.max(4294967293) }).strict();
// A server-provisioned exact upload authority, not a second first-create target.
// Revisions use the existing versioned file-session key and immutable head.
export const revisionUploadTargetSpec = z.object({ version: z.literal('knowledge-revision-upload-target-1'),
  from: lifecycleHead, upload: knowledgeUploadInput.strict(), targetVersion: id,
  expiresAt: z.string().datetime({ offset: true }) }).strict().refine(v => v.upload.documentId === v.from.documentId
    && v.targetVersion !== v.from.documentVersion);
export const revisionUploadResource = (spec: z.infer<typeof revisionUploadTargetSpec>) => ({ upload: {
  documentId: spec.upload.documentId, idempotencyKey: knowledgeUploadKey(spec.from.documentId, spec.targetVersion),
  fileName: spec.upload.fileName, mimeType: spec.upload.mimeType, sizeBytes: spec.upload.sizeBytes,
  revision: { documentVersion: spec.from.documentVersion, expectedRevision: spec.from.revision,
    aclRevision: spec.from.aclRevision, targetVersion: spec.targetVersion }
} });
const successorTarget = z.object({ version: z.literal('knowledge-successor-target-1'), action: z.literal('revise'),
  operationId: id, from: lifecycleHead,
  to: z.object({ documentVersion: id, attachmentId: id, uploadSessionId: id, title: z.string().min(1).max(256),
    validFrom: z.string().datetime({ offset: true }), validUntil: z.string().datetime({ offset: true }).optional() }).strict(),
  expiresAt: z.string().datetime({ offset: true }) }).strict().refine(v => v.to.documentVersion !== v.from.documentVersion
    && v.to.attachmentId !== v.from.attachmentId && (!v.to.validUntil || Date.parse(v.to.validUntil) > Date.parse(v.to.validFrom)));
const deletionTarget = z.object({ version: z.literal('knowledge-deletion-target-1'), action: z.literal('delete'),
  operationId: id, from: lifecycleHead, expiresAt: z.string().datetime({ offset: true }) }).strict();
export const lifecycleTargetSpec = z.union([successorTarget, deletionTarget]);
export const authorityTargetSpec = z.union([preparedTargetSpec, revisionUploadTargetSpec, lifecycleTargetSpec]);
export type KnowledgeLifecycleTarget = z.infer<typeof lifecycleTargetSpec>;
export const memoryResource = z.object({ memoryId: id, revision, aclRevision: revision, owner }).strict();
export const memoryOwnerResource = z.object({ owner }).strict();
export function canonicalPolicyResource(domain: string, action: string, input: unknown) {
  if (domain === 'knowledge') {
    managementParse(knowledgePolicyActions, action);
    if (action === 'upload') {
      const r = managementParse(z.object({ upload: knowledgeUploadInput.extend({ idempotencyKey: z.string().min(1).max(128), revision: knowledgeUploadRevisionSchema.optional() }).strict() }).strict(), input).upload;
      if (r.idempotencyKey !== knowledgeUploadKey(r.documentId, r.revision?.targetVersion)) throw new KnowledgePolicyManagementError('invalid_input');
      return { upload: { documentId: r.documentId, idempotencyKey: r.idempotencyKey, fileName: r.fileName, mimeType: r.mimeType, sizeBytes: r.sizeBytes,
        ...(r.revision ? { revision: r.revision } : {}) } };
    }
    if (z.object({}).strict().safeParse(input).success) return {};
    if (action === 'create' && z.object({ attachmentId: id }).strict().safeParse(input).success)
      return managementParse(z.object({ attachmentId: id }).strict(), input);
    const r = managementParse(documentResource, input);
    return { documentId: r.documentId, documentVersion: r.documentVersion, attachmentId: r.attachmentId, aclRevision: r.aclRevision };
  }
  if (domain !== 'memory') throw new KnowledgePolicyManagementError('invalid_input');
  managementParse(memoryPolicyActions, action);
  if (memoryOwnerResource.safeParse(input).success) {
    const r = managementParse(memoryOwnerResource, input);
    return { owner: { actorKind: r.owner.actorKind, actorId: r.owner.actorId } };
  }
  const r = managementParse(memoryResource, input);
  return { memoryId: r.memoryId, revision: r.revision, aclRevision: r.aclRevision, owner: { actorKind: r.owner.actorKind, actorId: r.owner.actorId } };
}
export const policyKey = (row: { tenantId: string; workspaceId: string; targetActorId: string; targetAudience: string; domain: string; action: string; resourceKey: string }) => ({
  tenantId: row.tenantId, workspaceId: row.workspaceId, actorKind: 'user', actorId: row.targetActorId,
  audience: row.targetAudience, domain: row.domain, action: row.action, resourceKey: row.resourceKey,
});
export const policyWhere = (key: ReturnType<typeof policyKey>) => ({ tenantId_workspaceId_actorKind_actorId_audience_domain_action_resourceKey: key });
export const policyKeyHash = (key: ReturnType<typeof policyKey>) => requestFingerprint(key);
export const managementIdentityHash = (c: { actor: unknown; audience: unknown; scope: unknown; access?: unknown }) => requestFingerprint({ actor: c.actor, audience: c.audience, scope: c.scope, access: c.access ?? null });
export const originalResourceKey = fingerprint;
export const managementFingerprint = requestFingerprint;
export const preparationFingerprint = (row: { tenantId: string; workspaceId: string; actorId: string; audience: string; commandJson: unknown;
  beforeJson: unknown; sourceHash: string; policyKeyHash: string; authorizationHash: string; authorityRevision: number; expiresAt: Date }) => requestFingerprint({
  version: AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION, scope: { tenantId: row.tenantId, workspaceId: row.workspaceId }, actorId: row.actorId, audience: row.audience,
  command: row.commandJson, before: row.beforeJson, sourceHash: row.sourceHash, policyKeyHash: row.policyKeyHash,
  authorizationHash: row.authorizationHash, authorityRevision: row.authorityRevision, expiresAt: row.expiresAt.toISOString(),
});
export type PolicyChange = z.infer<typeof policyChange>;
