/** Selected AI source ownership for the original Rental file-cleanup worker.
 * Locate without locks; after the caller locks Workspace, revalidate the same
 * transaction's Document -> Session source before Runtime locks Session -> File.
 * This neither grants knowledge reads nor creates deletion/retention intent.
 * Unsaved uploads and old attachments absent from the current head stay pending:
 * version/content/lifecycle receipts do not retain a reversible attachment ID. */
import { isDeepStrictEqual } from "node:util";
import { CoreAccessError } from "@rental-os/core-host";
import { AI_KNOWLEDGE_DRAFT_VERSION } from "@rental-os/shared";
import { frozenFileContentHash } from "@rental-os/platform-contracts/file-content-binding";
import { prismaRuntime } from "@rental-os/platform-server/prisma-runtime";
import type { RentalFileCleanupAuthorityDependencies } from "@rental-os/rental-core/application-file-cleanup-authority";
import { id, scopeSchema } from "@rental-os/ai-native-server/runtime/knowledge/knowledge-validation";
import { knowledgeUploadKey, knowledgeUploadRevisionSchema } from "@rental-os/ai-native-server/runtime/knowledge/human-knowledge-upload.service";

type Source = NonNullable<RentalFileCleanupAuthorityDependencies["knowledge"]>;
type Transaction = Parameters<Source["resolveOwnedWorkspace"]>[0];
type Boundary = Parameters<Source["resolveOwnedWorkspace"]>[1];
const denied = () => new CoreAccessError("denied", "原知识文件缺少已保存且一致的文档、附件或上传来源");
const record = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === "object" && !Array.isArray(value);
const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
const revision = (value: unknown): value is number => typeof value === "number"
  && Number.isInteger(value) && value >= 1 && value <= 4294967294;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
function knowledgeId(value: unknown, document = false): string {
  const parsed = (document ? id.max(36) : id).safeParse(value);
  if (!parsed.success) throw denied();
  return parsed.data;
}
function onlyRow(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1 || !record(value[0])) throw denied();
  return value[0];
}

async function readDocument(tx: Transaction, boundary: Boundary, locked: boolean) {
  const { asset } = boundary;
  // Only source metadata from the original KnowledgeRecord is selected. The
  // title is an encrypted body field; ownership does not decrypt it, substitute
  // a fake title, or certify body integrity. Dates also detect non-source edits.
  const row = onlyRow(await tx.$queryRaw<unknown>(prismaRuntime.sql`
    SELECT id, tenantId, workspaceId, revision, status, withdrawnAt, createdAt, updatedAt,
      CAST(JSON_OBJECT(
        'draftVersion', JSON_EXTRACT(state, '$.document.draftVersion'),
        'documentId', JSON_EXTRACT(state, '$.document.documentId'),
        'documentVersion', JSON_EXTRACT(state, '$.document.documentVersion'),
        'attachmentId', JSON_EXTRACT(state, '$.document.attachmentId'),
        'scope', JSON_EXTRACT(state, '$.document.scope'),
        'owner', JSON_EXTRACT(state, '$.document.owner'),
        'aclRevision', JSON_EXTRACT(state, '$.document.aclRevision'),
        'publication', JSON_EXTRACT(state, '$.document.publication'),
        'contentHash', JSON_EXTRACT(state, '$.contentHash'),
        'revision', JSON_EXTRACT(state, '$.revision')) AS CHAR) AS source
    FROM ai_knowledge_documents WHERE tenantId=${asset.tenantId} AND id=${asset.businessId}
    ${locked ? prismaRuntime.sql`LOCK IN SHARE MODE` : prismaRuntime.empty}`));
  let source: unknown;
  try {
    // CAST fixes the MySQL expression's wire type instead of treating an
    // untyped driver buffer as trusted JSON or returning the full stored body.
    if (typeof row.source !== "string" || Buffer.byteLength(row.source, "utf8") > 4096) throw denied();
    source = JSON.parse(row.source);
  } catch { throw denied(); }
  if (!record(source)) throw denied();
  const documentId = knowledgeId(source.documentId, true);
  const scope = scopeSchema.safeParse(source.scope);
  if (!scope.success || scope.data.kind !== "workspace" || scope.data.tenantId !== asset.tenantId
    || row.id !== asset.businessId || row.tenantId !== asset.tenantId || row.workspaceId !== scope.data.workspaceId
    || source.draftVersion !== AI_KNOWLEDGE_DRAFT_VERSION || documentId !== row.id
    || knowledgeId(source.attachmentId) !== asset.id || !revision(source.revision) || source.revision !== row.revision
    || source.contentHash !== null && (!text(source.contentHash) || !/^[a-f0-9]{64}$/u.test(source.contentHash)
      || !record(asset.metadata) || source.contentHash !== asset.metadata.knowledgeContentHash)
    || !revision(source.aclRevision) || source.publication !== row.status
    || !["draft", "published", "withdrawn", "deleted"].includes(String(source.publication))
    || !record(source.owner)
    || Object.keys(source.owner).length !== 2 || !["user", "saas_admin", "customer", "automation"].includes(String(source.owner.actorKind))
    || !validDate(row.createdAt) || !validDate(row.updatedAt)
    || (row.status === "withdrawn" ? !validDate(row.withdrawnAt) : row.withdrawnAt !== null)) throw denied();
  knowledgeId(source.owner.actorId);
  const documentVersion = knowledgeId(source.documentVersion);
  return { id: documentId, tenantId: scope.data.tenantId, workspaceId: scope.data.workspaceId,
    revision: source.revision, aclRevision: source.aclRevision, documentVersion,
    source, createdAt: row.createdAt, updatedAt: row.updatedAt, withdrawnAt: row.withdrawnAt };
}

function sessionProjection(value: Record<string, unknown>) {
  if (!text(value.id) || !text(value.tenantId) || !text(value.fileAssetId) || !text(value.provider)
    || !text(value.storageKey) || !text(value.idempotencyKey) || value.status !== "completed"
    || !validDate(value.completedAt) || !validDate(value.expiresAt) || !validDate(value.updatedAt)) throw denied();
  return { id: value.id, tenantId: value.tenantId, fileAssetId: value.fileAssetId,
    provider: value.provider, storageKey: value.storageKey, idempotencyKey: value.idempotencyKey,
    status: value.status, completedAt: value.completedAt, expiresAt: value.expiresAt, updatedAt: value.updatedAt };
}
async function readSession(tx: Transaction, boundary: Boundary, locked: boolean) {
  const { asset } = boundary;
  const session = sessionProjection(onlyRow(await tx.$queryRaw<unknown>(prismaRuntime.sql`
    SELECT id, tenantId, fileAssetId, provider, storageKey, idempotencyKey, status, completedAt, expiresAt, updatedAt
    FROM file_upload_sessions WHERE tenantId=${asset.tenantId} AND fileAssetId=${asset.id}
    ${locked ? prismaRuntime.sql`FOR UPDATE` : prismaRuntime.empty}`)));
  if (session.tenantId !== asset.tenantId || session.fileAssetId !== asset.id
    || session.provider !== asset.storageProvider || session.storageKey !== asset.storageKey
    || boundary.session && !isDeepStrictEqual(session, sessionProjection({ ...boundary.session }))) throw denied();
  return session;
}

export function createRentalAiFileCleanupSource(): Source {
  return Object.freeze({ async resolveOwnedWorkspace(tx: Transaction, value: Boundary) {
    const boundary = structuredClone(value), { asset } = boundary;
    if (typeof tx?.$queryRaw !== "function" || !["claim", "observe", "prepare"].includes(boundary.phase)
      || !["expired_upload", "completed_staging", "pending_delete"].includes(boundary.operation)
      || asset.businessModule !== "ai-native" || asset.businessType !== "ai_knowledge_document"
      || asset.uploadScene !== "ai-knowledge" || asset.storageProvider === "local_mock") throw denied();
    knowledgeId(asset.tenantId); knowledgeId(asset.id); knowledgeId(asset.businessId, true);
    const metadata = asset.metadata;
    if (!record(metadata) || metadata.knowledgeUploadVersion !== 1 || !text(asset.uploadedBy)
      || !text(metadata.knowledgeContentHash) || frozenFileContentHash(asset) !== metadata.knowledgeContentHash) throw denied();
    const selection = metadata.knowledgeRevision === undefined ? undefined : knowledgeUploadRevisionSchema.safeParse(metadata.knowledgeRevision);
    if (selection && !selection.success) throw denied();
    const selected = selection?.data;
    const document = await readDocument(tx, boundary, false);
    // Metadata only corroborates the persisted document; it never selects the
    // workspace. A revision retains its original owner's identity, so an old
    // document owner is not incorrectly equated with a later uploader.
    if (metadata.workspaceId !== document.workspaceId || selected && (selected.targetVersion !== document.documentVersion
      || selected.documentVersion === selected.targetVersion || document.revision <= selected.expectedRevision
      || document.aclRevision < selected.aclRevision)) throw denied();
    const session = await readSession(tx, boundary, false);
    if (session.idempotencyKey !== knowledgeUploadKey(document.id, selected?.targetVersion)) throw denied();
    return Object.freeze({ workspaceId: document.workspaceId, async assertLocked() {
      // The caller MUST hold the original Workspace parent now. Neither the
      // locator nor its closure opens another transaction or locks File early.
      const current = await readDocument(tx, boundary, true);
      if (!isDeepStrictEqual(current, document)) throw denied();
      // Cleanup's claim will write this session; take its original X lock now
      // instead of two concurrent S owners both trying to upgrade at the CAS.
      if (!isDeepStrictEqual(await readSession(tx, boundary, true), session)) throw denied();
    } });
  } });
}
