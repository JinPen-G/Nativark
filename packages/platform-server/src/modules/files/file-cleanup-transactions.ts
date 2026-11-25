/** 原清理占用的文件锁、完整快照和调用内收据。宿主在文件锁前核所属业务权威。
 * 只有已确认提交的原占用可以派发DELETE，结果或HEAD继续使用同一收据与原键。 */
import { ConflictException } from "@nestjs/common";
import type { Sql } from "@prisma/client/runtime/library";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import { prismaRuntime } from "../../prisma-runtime";
import type { TenantIntegrationRuntimeConfig } from "../integrations/tenant-integration.service";
import type { FileCleanupBoundary, FileCleanupParticipants, FileCleanupTransaction } from "./file-cleanup";

export interface FileCleanupLockedTransaction extends FileCleanupTransaction {
  $queryRaw<T>(query: Sql): PromiseLike<T>;
}

export interface FileCleanupObjectRequest {
  method: "DELETE" | "HEAD";
  config: TenantIntegrationRuntimeConfig;
  storageKey: string;
}

export interface FileCleanupTransactionParticipants<Transaction extends FileCleanupLockedTransaction> {
  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
  authorize(transaction: Transaction, boundary: FileCleanupBoundary, beforeFileLocks?: () => Promise<void>): Promise<void>;
  assertConfiguration(transaction: Transaction, config: TenantIntegrationRuntimeConfig): Promise<void>;
  assertObjectBinding?(boundary: FileCleanupBoundary, request: FileCleanupObjectRequest): void;
}

export function createOriginalFileCleanupTransactions<Transaction extends FileCleanupLockedTransaction>(
  tenantId: string,
  participants: FileCleanupTransactionParticipants<Transaction>
): Pick<FileCleanupParticipants<Transaction>, "transaction" | "resultTransaction" | "beforeObjectRequest"> {
  // 日期先按原JSON规范化，收据比较保持完整版本与有效期。
  const stable = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
  const changed = () => new ConflictException("原文件清理占用、对象或运输依据已变化");
  const key = (boundary: FileCleanupBoundary) => `${boundary.operation}:${boundary.asset.id}:${boundary.session?.id ?? ""}`;
  const content = (boundary: FileCleanupBoundary) => ({
    asset: boundary.asset,
    ...(boundary.session ? { session: boundary.session } : {})
  });
  const receipts = new Map<string, { method: "DELETE" | "HEAD"; hash: string }>();
  const read = async (tx: Transaction, boundary: FileCleanupBoundary) => {
    const asset = await tx.fileAsset.findFirst({ where: { id: boundary.asset.id, tenantId } });
    if (!asset) throw changed();
    if (!boundary.session) return { asset };
    const sessions = await tx.fileUploadSession.findMany({
      where: { id: boundary.session.id, tenantId }, orderBy: { expiresAt: "asc" }, take: 2
    });
    if (sessions.length !== 1) throw changed();
    return { asset, session: sessions[0] };
  };
  const lockSnapshot = async (tx: Transaction, boundary: FileCleanupBoundary, write = false) => {
    if (boundary.asset.tenantId !== tenantId || boundary.session && boundary.session.tenantId !== tenantId) {
      throw changed();
    }
    // 保持原Session→File锁序，所属主体/Core锁由authorize在本段之前取得。
    if (boundary.session) {
      const sessions = await tx.$queryRaw<Array<{ id: string }>>(prismaRuntime.sql`
        SELECT id FROM file_upload_sessions WHERE tenantId=${tenantId} AND id=${boundary.session.id}
        ${write ? prismaRuntime.sql`FOR UPDATE` : prismaRuntime.sql`LOCK IN SHARE MODE`}`);
      if (sessions.length !== 1 || sessions[0].id !== boundary.session.id) throw changed();
    }
    const assets = await tx.$queryRaw<Array<{ id: string }>>(prismaRuntime.sql`
      SELECT id FROM FileAsset WHERE tenantId=${tenantId} AND id=${boundary.asset.id}
      ${write ? prismaRuntime.sql`FOR UPDATE` : prismaRuntime.sql`LOCK IN SHARE MODE`}`);
    if (assets.length !== 1 || assets[0].id !== boundary.asset.id || stable(await read(tx, boundary)) !== stable(content(boundary))) {
      throw changed();
    }
  };
  const original = (boundary: FileCleanupBoundary) => {
    const receipt = receipts.get(key(boundary));
    if (!receipt || receipt.hash !== stable(content(boundary))) throw changed();
    return receipt;
  };
  const transaction = async <T>(work: (tx: Transaction) => Promise<T>, value: FileCleanupBoundary): Promise<T> => {
    const boundary = structuredClone(value);
    const receipt = ["prepare", "result"].includes(boundary.phase) ? original(boundary) : undefined;
    const committed = await participants.transaction(async tx => {
      if (!receipt) await participants.authorize(tx, boundary);
      await lockSnapshot(tx, boundary, true);
      const result = await work(tx);
      return { result, hash: stable(await read(tx, boundary)) };
    });
    // 失应答不会执行此登记，因此不能从状态或TTL制造本次派发许可。
    receipts.set(key(boundary), {
      method: receipt?.method ?? (boundary.phase === "claim" ? "DELETE" : "HEAD"), hash: committed.hash
    });
    return committed.result;
  };
  return {
    transaction,
    resultTransaction: (work, boundary) => transaction(work, boundary),
    beforeObjectRequest: async (value, request) => {
      const boundary = structuredClone(value);
      const { asset } = boundary;
      const receipt = original(boundary);
      if (receipt.method !== request.method) throw changed();
      const metadata = asset.metadata as Record<string, unknown> | null;
      const storageKey = boundary.operation === "completed_staging" ? `${metadata?.stagingStorageKey}.pending-upload`
        : boundary.operation === "expired_upload" && metadata?.fileUploadVersion === 2 ? `${asset.storageKey}.pending-upload` : asset.storageKey;
      if (request.storageKey !== storageKey || request.config.provider !== asset.storageProvider) throw changed();
      participants.assertObjectBinding?.(boundary, request);
      await participants.transaction(async tx => {
        const configuration = () => participants.assertConfiguration(tx, request.config);
        if (request.method === "DELETE") await participants.authorize(tx, boundary, configuration);
        else await configuration();
        await lockSnapshot(tx, boundary);
      });
    }
  };
}
