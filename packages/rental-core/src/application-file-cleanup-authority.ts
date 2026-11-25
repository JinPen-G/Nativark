/** Rental's three original file-maintenance executors. The persisted business
 * object proves ownership; labels/metadata never select a Core or a workspace.
 * Disabled grants permit only these existing cleanup facts. No user identity,
 * new upload, retention policy, object transport or receipt retry is created. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";
import { prismaRuntime } from "@rental-os/platform-server/prisma-runtime";
import type { FileCleanupParticipants } from "@rental-os/platform-server/files";
import { CoreBindingSchema, CoreScopeReferenceSchema, TenantCoreGrantSchema, isCoreVersionSupported } from "@rental-os/core-contracts";
import { CoreAccessError, coreBindingScopeKey, type CoreDeploymentAvailability } from "@rental-os/core-host";
import { RENTAL_CORE_ID, RENTAL_CORE_VERSION, RENTAL_WORKSPACE_CONTAINER_TYPE } from "./core-identity";
import { RENTAL_DATA_READABLE } from "./data";

export type RentalFileCleanupBoundary = Parameters<FileCleanupParticipants<Prisma.TransactionClient>["transaction"]>[1];
export type RentalFileCleanupTransaction = Pick<Prisma.TransactionClient, "$queryRaw" | "rentalOrder" | "rentalQuote"
  | "rentalItemGroup" | "rentalAsset" | "rentalWorkOrder" | "customerProfile" | "customerCorporateContract"
  | "customerCorporateInvoiceProfile" | "customerCorporateCredit" | "customerMembershipReview" | "asyncJob" | "documentPrintJob">;

export interface RentalFileCleanupAuthority {
  /** Called before any file/session lock in the original transaction. The
   * Runtime-owned callback checks the original provider config before the
   * optional knowledge source takes Document/Session locks. Never request data. */
  assert(transaction: RentalFileCleanupTransaction, boundary: RentalFileCleanupBoundary,
    beforeFileLocks?: () => Promise<void>): Promise<void>;
}

export interface RentalFileCleanupAuthorityDependencies {
  deploymentForTransaction(transaction: Pick<RentalFileCleanupTransaction, "$queryRaw">): CoreDeploymentAvailability;
  /** The locator reads an existing original document/source without locking it.
   * After Binding/Workspace, assertLocked holds its original Document/Session
   * locks and rechecks that exact projection in this same transaction. */
  knowledge?: {
    resolveOwnedWorkspace(transaction: RentalFileCleanupTransaction, boundary: RentalFileCleanupBoundary): Promise<{
      readonly workspaceId: string;
      assertLocked(): Promise<void>;
    }>;
  };
}

const operations = ["expired_upload", "completed_staging", "pending_delete"] as const;
export const RENTAL_FILE_CLEANUP_DESCRIPTORS = Object.freeze(operations.map(operation => Object.freeze({
  id: `file_${operation}`, operation, coreId: RENTAL_CORE_ID, implementationVersion: RENTAL_CORE_VERSION,
  purpose: "original_file_cleanup" as const
})));
const denied = () => new CoreAccessError("denied", "原文件清理缺少当前租户、Rental归属或已登记善后依据");
const nonempty = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
const active = (value: unknown) => typeof value === "string" && value.toLowerCase() === "active";
// These are fixed original tables, never a table name supplied by file metadata.
const sourceTables = {
  rentalOrder: { table: "rental_orders", order: 0 }, customerProfile: { table: "customer_profiles", order: 0 },
  rentalQuote: { table: "rental_quotes", order: 2 }, rentalItemGroup: { table: "rental_item_groups", order: 2 },
  rentalAsset: { table: "rental_assets", order: 2 }, rentalWorkOrder: { table: "rental_work_orders", order: 3 },
  customerCorporateContract: { table: "customer_corporate_contracts", order: 3 },
  customerCorporateInvoiceProfile: { table: "customer_corporate_invoice_profiles", order: 3 },
  customerCorporateCredit: { table: "customer_corporate_credits", order: 3 },
  customerMembershipReview: { table: "customer_membership_reviews", order: 3 },
  asyncJob: { table: "AsyncJob", order: 4 }, documentPrintJob: { table: "DocumentPrintJob", order: 4 }
} as const;
type SourceRow = { id: string; tenantId: string; workspaceId?: string; customerId?: string;
  sourceWorkspaceId?: string | null; orderId?: string | null; assetId?: string | null;
  businessType?: string | null; businessId?: string | null };
type SourceEvidence = { sourceWorkspaceId?: string;
  rows: Array<{ source: keyof typeof sourceTables; row: SourceRow }> };

export function createRentalFileCleanupAuthority(input: RentalFileCleanupAuthorityDependencies): RentalFileCleanupAuthority {
  if (typeof input?.deploymentForTransaction !== "function"
    || input.knowledge !== undefined && typeof input.knowledge.resolveOwnedWorkspace !== "function")
    throw new CoreAccessError("core_unavailable", "Rental 文件清理缺少真实部署或知识来源参加者");

  const locate = async (tx: RentalFileCleanupTransaction, tenantId: string, type: string, id: string,
    seen: Set<string>, evidence: SourceEvidence): Promise<string | undefined> => {
    const key = `${type}:${id}`;
    if (seen.has(key) || seen.size >= 4 || !nonempty(id)) throw denied();
    seen.add(key);
    const where = { tenantId, id }, workspace = { id: true, tenantId: true, workspaceId: true } as const;
    const tenant = { id: true, tenantId: true } as const;
    let row: SourceRow | null, source: keyof typeof sourceTables;
    // First locate the original references without locks, then lock parents in
    // their original order and re-read this complete projection. Tenant S alone
    // does not exclude business writers that also hold a shared Tenant lock.
    switch (type) {
      case "order": case "rental_order": case "order_contract":
        source = "rentalOrder"; row = await tx.rentalOrder.findFirst({ where, select: workspace }); break;
      case "quote": case "rental_quote":
        source = "rentalQuote"; row = await tx.rentalQuote.findFirst({ where, select: workspace }); break;
      case "item_group": case "rental_item_group":
        source = "rentalItemGroup"; row = await tx.rentalItemGroup.findFirst({ where, select: workspace }); break;
      case "asset": case "rental_asset":
        source = "rentalAsset"; row = await tx.rentalAsset.findFirst({ where, select: workspace }); break;
      case "work_order": case "rental_work_order":
        source = "rentalWorkOrder";
        row = await tx.rentalWorkOrder.findFirst({ where, select: { ...workspace, orderId: true, assetId: true } });
        if (row?.orderId && await locate(tx, tenantId, "rental_order", row.orderId, seen, evidence) !== row.workspaceId) throw denied();
        if (row?.assetId && await locate(tx, tenantId, "rental_asset", row.assetId, seen, evidence) !== row.workspaceId) throw denied();
        break;
      case "customer": case "customer_profile":
        source = "customerProfile"; row = await tx.customerProfile.findFirst({ where, select: tenant }); break;
      case "customer_contract": case "corporate_contract":
        source = "customerCorporateContract";
        row = await tx.customerCorporateContract.findFirst({ where, select: { ...tenant, customerId: true } }); break;
      case "customer_invoice_profile": case "invoice_profile":
        source = "customerCorporateInvoiceProfile";
        row = await tx.customerCorporateInvoiceProfile.findFirst({ where, select: { ...tenant, customerId: true } }); break;
      case "customer_credit": case "credit":
        source = "customerCorporateCredit";
        row = await tx.customerCorporateCredit.findFirst({ where, select: { ...tenant, customerId: true } }); break;
      case "membership_review": {
        source = "customerMembershipReview";
        row = await tx.customerMembershipReview.findFirst({ where, select: { ...tenant, customerId: true, sourceWorkspaceId: true } });
        // The historical source workspace is only an audit origin. Its real
        // tenant must match, but it never grants this tenant-shared file scope.
        if (row?.sourceWorkspaceId) evidence.sourceWorkspaceId = row.sourceWorkspaceId;
        break;
      }
      case "async_job": case "document_print_job": {
        const select = { ...tenant, businessType: true, businessId: true } as const;
        const reference = type === "async_job" ? await tx.asyncJob.findFirst({ where, select })
          : await tx.documentPrintJob.findFirst({ where, select });
        if (!reference || reference.id !== id || reference.tenantId !== tenantId || !reference.businessType || !reference.businessId) throw denied();
        evidence.rows.push({ source: type === "async_job" ? "asyncJob" : "documentPrintJob", row: reference });
        return locate(tx, tenantId, reference.businessType, reference.businessId, seen, evidence);
      }
      default: throw denied();
    }
    if (!row || row.id !== id || row.tenantId !== tenantId || "workspaceId" in row && !nonempty(row.workspaceId)) throw denied();
    if (row.customerId) await locate(tx, tenantId, "customer", row.customerId, seen, evidence);
    evidence.rows.push({ source, row });
    return row.workspaceId;
  };

  return Object.freeze({ async assert(tx: RentalFileCleanupTransaction, value: RentalFileCleanupBoundary,
    beforeFileLocks?: () => Promise<void>): Promise<void> {
    const boundary = structuredClone(value), { asset } = boundary, tenantId = asset?.tenantId;
    if (!operations.some(operation => operation === boundary.operation) || !["claim", "observe", "prepare"].includes(boundary.phase)
      || !nonempty(tenantId) || !nonempty(asset.id) || !nonempty(asset.businessId)) throw denied();
    // The namespace only excludes other owners. It grants nothing without the
    // original relational source below, even when supplied metadata looks valid.
    const memberTypes = ["customer", "customer_profile", "membership_review", "customer_contract", "corporate_contract",
      "customer_invoice_profile", "invoice_profile", "customer_credit", "credit"];
    if (asset.businessType === "ai_knowledge_document"
      ? asset.businessModule !== "ai-native" || asset.uploadScene !== "ai-knowledge"
      : !(["rental-core", "rental-os"].includes(asset.businessModule)
        || asset.businessModule === "membership" && memberTypes.includes(asset.businessType)
        || asset.businessModule === "enterprise" && asset.businessType === "rental_order"
          && asset.uploadScene === "enterprise-payment-proof")) throw denied();
    const session = boundary.session;
    if (boundary.operation !== "pending_delete" && (!session || session.tenantId !== tenantId || session.fileAssetId !== asset.id
      || session.storageKey !== asset.storageKey || session.provider !== asset.storageProvider)) throw denied();
    // An operation name cannot promote an active file into a deletion target.
    if (boundary.operation === "pending_delete" && !["delete_queued", "delete_pending", "delete_in_progress"].includes(asset.status)
      || boundary.operation === "expired_upload" && (!session || session.completedAt !== null
        || session.expiresAt.getTime() > Date.now() || !["pending_upload", "failed"].includes(asset.status)
        || !["pending_upload", "failed", "cleanup_in_progress"].includes(session.status))
      || boundary.operation === "completed_staging" && (!session || session.status !== "completed" || !session.completedAt
        || !["active", "delete_queued", "delete_pending", "delete_in_progress", "deleted"].includes(asset.status))) throw denied();
    const tenants = await tx.$queryRaw<Array<{ id: string; status: string }>>(prismaRuntime.sql`
      SELECT id, status FROM Tenant WHERE id=${tenantId} LOCK IN SHARE MODE`);
    if (tenants.length !== 1 || tenants[0].id !== tenantId || !active(tenants[0].status)) throw denied();
    const gates = await tx.$queryRaw<Array<{ tenantId: string; coreId: string }>>(prismaRuntime.sql`
      SELECT tenant_id AS tenantId, core_id AS coreId FROM platform_core_access_locks
      WHERE tenant_id=${tenantId} AND core_id=${RENTAL_CORE_ID} LOCK IN SHARE MODE`);
    if (gates.length !== 1 || gates[0].tenantId !== tenantId || gates[0].coreId !== RENTAL_CORE_ID) throw denied();
    const grants = await tx.$queryRaw<Array<{ state: string; revision: bigint | number; operationId: string }>>(prismaRuntime.sql`
      SELECT state, revision, operation_id AS operationId FROM platform_tenant_core_grants
      WHERE tenant_id=${tenantId} AND core_id=${RENTAL_CORE_ID} LOCK IN SHARE MODE`);
    const grant = grants.length === 1 ? TenantCoreGrantSchema.safeParse({ ...grants[0], tenantId, coreId: RENTAL_CORE_ID,
      revision: Number(grants[0].revision) }) : undefined;
    if (!grant?.success || !["enabled", "disabled"].includes(grant.data.state)) throw denied();
    // Knowledge is not a Rental table. Only its selected original source can
    // prove an attachment relationship; an upload before first save may remain pending.
    const evidence: SourceEvidence = { rows: [] };
    const knowledge = asset.businessType === "ai_knowledge_document"
      ? await (input.knowledge?.resolveOwnedWorkspace(tx, boundary) ?? Promise.reject(denied()))
      : undefined;
    if (asset.businessType === "ai_knowledge_document" && (!knowledge || !nonempty(knowledge.workspaceId)
      || typeof knowledge.assertLocked !== "function")) throw denied();
    const workspaceId = knowledge?.workspaceId ?? await locate(tx, tenantId, asset.businessType, asset.businessId!, new Set(), evidence);
    const scope = CoreScopeReferenceSchema.parse({ coreId: RENTAL_CORE_ID, tenantId,
      ...(workspaceId ? { container: { type: RENTAL_WORKSPACE_CONTAINER_TYPE, id: workspaceId } } : {}) });
    const scopeKey = coreBindingScopeKey(scope), hash = createHash("sha256").update(scopeKey).digest("hex");
    const bindings = await tx.$queryRaw<Array<{ bindingId: string; revision: bigint | number; dataVersion: string;
      containerType: string | null; containerId: string | null }>>(prismaRuntime.sql`
      SELECT binding_id AS bindingId, revision, data_version AS dataVersion, container_type AS containerType, container_id AS containerId
      FROM platform_core_bindings WHERE tenant_id=${tenantId} AND core_id=${RENTAL_CORE_ID} AND scope_hash=${hash} LOCK IN SHARE MODE`);
    const row = bindings.length === 1 ? bindings[0] : undefined;
    const binding = row && CoreBindingSchema.safeParse({ coreId: RENTAL_CORE_ID, tenantId, bindingId: row.bindingId,
      revision: Number(row.revision), dataVersion: row.dataVersion,
      ...(row.containerType !== null || row.containerId !== null ? { container: { type: row.containerType, id: row.containerId } } : {}) });
    if (!binding?.success || coreBindingScopeKey(binding.data) !== scopeKey
      || !isCoreVersionSupported(binding.data.dataVersion, RENTAL_DATA_READABLE)) throw denied();
    const lockRows = async (beforeWorkspace: boolean) => {
      const rows = evidence.rows.filter(value => (sourceTables[value.source].order === 0) === beforeWorkspace)
        .sort((left, right) => sourceTables[left.source].order - sourceTables[right.source].order
          || left.source.localeCompare(right.source) || left.row.id.localeCompare(right.row.id));
      for (const { source, row } of rows) {
        const locked = await tx.$queryRaw<Array<{ id: string; tenantId: string }>>(prismaRuntime.sql`
          SELECT id, tenantId FROM ${prismaRuntime.raw(sourceTables[source].table)}
          WHERE tenantId=${tenantId} AND id=${row.id} LOCK IN SHARE MODE`);
        if (locked.length !== 1 || locked[0].id !== row.id || locked[0].tenantId !== tenantId) throw denied();
      }
    };
    await lockRows(true);
    if (workspaceId) {
      const rows = await tx.$queryRaw<Array<{ id: string; tenantId: string; status: string }>>(prismaRuntime.sql`
        SELECT id, tenantId, status FROM business_workspaces WHERE tenantId=${tenantId} AND id=${workspaceId} LOCK IN SHARE MODE`);
      if (rows.length !== 1 || rows[0].id !== workspaceId || rows[0].tenantId !== tenantId || !active(rows[0].status)) throw denied();
    }
    if (evidence.sourceWorkspaceId) {
      const rows = await tx.$queryRaw<Array<{ id: string; tenantId: string }>>(prismaRuntime.sql`
        SELECT id, tenantId FROM business_workspaces
        WHERE tenantId=${tenantId} AND id=${evidence.sourceWorkspaceId} LOCK IN SHARE MODE`);
      if (rows.length !== 1 || rows[0].id !== evidence.sourceWorkspaceId || rows[0].tenantId !== tenantId) throw denied();
    }
    await lockRows(false);
    // Original upload completion takes Config before Session. A knowledge source
    // may already hold its Session when returning, so that check must run here.
    await beforeFileLocks?.();
    if (knowledge) await knowledge.assertLocked();
    else {
      const current: SourceEvidence = { rows: [] };
      if (await locate(tx, tenantId, asset.businessType, asset.businessId!, new Set(), current) !== workspaceId
        || !isDeepStrictEqual(current, evidence)) throw denied();
    }
    const deployment = input.deploymentForTransaction(tx);
    if (typeof deployment?.requireAvailable !== "function") throw new CoreAccessError("core_unavailable", "Rental 文件清理缺少同事务部署观察器");
    await deployment.requireAvailable(RENTAL_CORE_ID, tenantId);
  } });
}
