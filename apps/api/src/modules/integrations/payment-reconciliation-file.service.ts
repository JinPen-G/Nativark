import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  PaymentStatementBatchDetail,
  PaymentStatementBatchSummary,
  PaymentStatementKind,
  PaymentStatementLineSummary,
  PaymentStatementReviewStatus,
  ReviewPaymentStatementLineRequest
} from "@rental-os/shared";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";

const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;
const MAX_STATEMENT_ROWS = 10_000;
const SUPPORTED_PROVIDERS = new Set(["alipay", "wechat_pay"]);

export interface UploadedPaymentStatement {
  originalname: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
}

interface ParsedStatementRow {
  rowNumber: number;
  kind: PaymentStatementKind;
  merchantOrderNo: string;
  merchantRefundNo?: string;
  externalId?: string;
  statementStatus: string;
  normalizedStatus: string;
  amount: number;
  currency: string;
  occurredAt?: Date;
  parseWarnings: string[];
}

function text(value: string | undefined, max = 191) {
  return String(value ?? "").trim().slice(0, max);
}

function csvRows(value: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new BadRequestException("对账文件 CSV 引号未闭合");
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function headerKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/gu, "_");
}

function firstValue(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    if (row[key]?.trim()) return row[key].trim();
  }
  return undefined;
}

function money(value: string | undefined, label: string) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/u.test(raw)) throw new BadRequestException(`${label}必须是最多两位小数的非负金额`);
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException(`${label}必须大于 0`);
  return Math.round(amount * 100) / 100;
}

function normalizePaymentStatus(value: string) {
  const status = value.trim().toUpperCase();
  if (["SUCCESS", "TRADE_SUCCESS", "PAID", "PAY_SUCCESS"].includes(status)) return "paid";
  if (["CLOSED", "TRADE_CLOSED", "REVOKED", "PAYERROR", "REFUND"].includes(status)) return "closed";
  if (["NOTPAY", "USERPAYING", "PROCESSING", "WAIT_BUYER_PAY", "PENDING"].includes(status)) return "pending";
  return "unknown";
}

function normalizeRefundStatus(value: string) {
  const status = value.trim().toUpperCase();
  if (["SUCCESS", "REFUND_SUCCESS", "REFUND_SUCCEED", "SUCCEEDED"].includes(status)) return "succeeded";
  if (["CLOSED", "REFUND_CLOSED", "FAIL", "FAILED", "REFUND_FAIL"].includes(status)) return "failed";
  if (["PROCESSING", "REFUND_PROCESSING", "PENDING", "ACCEPTED"].includes(status)) return "pending";
  return "unknown";
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function decimal(value: unknown) {
  return Math.round(Number(value) * 100) / 100;
}

function jsonArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function parsePaymentStatementCsv(buffer: Buffer, provider: string): ParsedStatementRow[] {
  if (!SUPPORTED_PROVIDERS.has(provider)) throw new BadRequestException("暂只支持支付宝和微信支付对账文件");
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_STATEMENT_BYTES) throw new BadRequestException("对账文件必须在 1B 到 10MB 之间");
  const content = buffer.toString("utf8").replace(/^\uFEFF/u, "");
  if (content.includes("\u0000")) throw new BadRequestException("对账文件包含非法控制字符");
  const rows = csvRows(content);
  if (rows.length < 2) throw new BadRequestException("对账文件至少需要表头和一条明细");
  const headers = rows[0].map(headerKey);
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  if (!headerIndex.has("kind") || !headerIndex.has("status") || !headerIndex.has("amount") || !headerIndex.has("currency")) {
    throw new BadRequestException("对账文件必须包含 kind、status、amount、currency 列");
  }
  const result: ParsedStatementRow[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    if (result.length >= MAX_STATEMENT_ROWS) throw new BadRequestException(`对账文件最多 ${MAX_STATEMENT_ROWS} 行`);
    const values = rows[index];
    const record: Record<string, string> = {};
    for (const [header, column] of headerIndex) record[header] = text(values[column]);
    const kindValue = firstValue(record, ["kind", "type"])?.toLowerCase();
    if (kindValue !== "payment" && kindValue !== "refund") throw new BadRequestException(`第 ${index + 1} 行 kind 必须是 payment 或 refund`);
    const kind = kindValue as PaymentStatementKind;
    const merchantOrderNo = firstValue(record, ["merchant_order_no", "out_trade_no", "merchant_order"]);
    if (!merchantOrderNo) throw new BadRequestException(`第 ${index + 1} 行缺少商户订单号`);
    const merchantRefundNo = firstValue(record, ["merchant_refund_no", "out_refund_no", "merchant_refund"]);
    if (kind === "refund" && !merchantRefundNo) throw new BadRequestException(`第 ${index + 1} 行退款记录缺少商户退款单号`);
    const statementStatus = firstValue(record, ["status", "trade_status", "refund_status"]) ?? "";
    if (!statementStatus) throw new BadRequestException(`第 ${index + 1} 行缺少平台状态`);
    const currency = (firstValue(record, ["currency", "currency_code"]) ?? "").toUpperCase();
    if (!/^[A-Z]{3}$/u.test(currency)) throw new BadRequestException(`第 ${index + 1} 行币种必须是 3 位字母`);
    const occurredRaw = firstValue(record, ["occurred_at", "success_time", "trade_time", "refund_time"]);
    const occurredAt = occurredRaw ? new Date(occurredRaw) : undefined;
    const parseWarnings: string[] = [];
    if (occurredRaw && (!occurredAt || Number.isNaN(occurredAt.getTime()))) parseWarnings.push("invalid_occurred_at");
    result.push({
      rowNumber: index,
      kind,
      merchantOrderNo: merchantOrderNo.slice(0, 191),
      merchantRefundNo: merchantRefundNo?.slice(0, 191),
      externalId: firstValue(record, kind === "payment" ? ["external_id", "trade_no", "transaction_id"] : ["external_id", "refund_id"])?.slice(0, 191),
      statementStatus: statementStatus.slice(0, 80),
      normalizedStatus: kind === "payment" ? normalizePaymentStatus(statementStatus) : normalizeRefundStatus(statementStatus),
      amount: money(firstValue(record, ["amount", "total_amount", "refund_amount"]), "对账金额"),
      currency,
      occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : undefined,
      parseWarnings
    });
  }
  return result;
}

@Injectable()
export class PaymentReconciliationFileService {
  constructor(private readonly prisma: PrismaService) {}

  async importStatement(tenantId: string, workspaceId: string, provider: string, file: UploadedPaymentStatement, operator?: string) {
    const normalizedProvider = provider.trim().toLowerCase();
    const rows = parsePaymentStatementCsv(file.buffer, normalizedProvider);
    const fileSha256 = sha256(file.buffer);
    const existing = await this.prisma.paymentReconciliationBatch.findFirst({ where: { tenantId, workspaceId, provider: normalizedProvider, fileSha256 } });
    if (existing) return this.getBatch(tenantId, workspaceId, existing.id);

    const orderNos = [...new Set(rows.map((row) => row.merchantOrderNo))];
    const refundNos = [...new Set(rows.map((row) => row.merchantRefundNo).filter((value): value is string => Boolean(value)))];
    const [intents, refunds] = await Promise.all([
      this.prisma.rentalPaymentIntent.findMany({ where: { tenantId, workspaceId, merchantOrderNo: { in: orderNos } } }),
      this.prisma.rentalPaymentRefund.findMany({ where: { tenantId, workspaceId, merchantRefundNo: { in: refundNos } } })
    ]);
    const intentByOrder = new Map(intents.map((row) => [row.merchantOrderNo, row]));
    const refundByNo = new Map(refunds.map((row) => [row.merchantRefundNo, row]));
    const seen = new Set<string>();
    const lineData = rows.map((row) => {
      const key = `${row.kind}:${row.merchantRefundNo ?? row.merchantOrderNo}`;
      const duplicate = seen.has(key);
      seen.add(key);
      const local = row.kind === "payment" ? intentByOrder.get(row.merchantOrderNo) : row.merchantRefundNo ? refundByNo.get(row.merchantRefundNo) : undefined;
      const codes = [...row.parseWarnings];
      if (duplicate) codes.push("duplicate_statement_key");
      if (!local) codes.push("local_record_missing");
      if (row.normalizedStatus === "unknown") codes.push("unsupported_status");
      if (local) {
        const localAmount = decimal(local.amount);
        if (Math.abs(localAmount - row.amount) > 0.005) codes.push("amount_mismatch");
        if (String(local.currency).toUpperCase() !== row.currency) codes.push("currency_mismatch");
        if (local.provider !== normalizedProvider) codes.push("provider_mismatch");
        const localStatus = row.kind === "payment" ? normalizePaymentStatus(local.status) : normalizeRefundStatus(local.status);
        if (row.normalizedStatus !== "unknown" && localStatus !== row.normalizedStatus) codes.push("status_mismatch");
        const localExternalId = row.kind === "payment"
          ? (local as (typeof intents)[number]).externalTransactionId
          : (local as (typeof refunds)[number]).externalRefundId;
        if (row.externalId && localExternalId && row.externalId !== localExternalId) codes.push("external_id_mismatch");
        if (row.normalizedStatus === (row.kind === "payment" ? "paid" : "succeeded") && !localExternalId) codes.push("local_external_id_missing");
      }
      const uniqueCodes = [...new Set(codes)];
      const localStatus = local?.status;
      return {
        rowNumber: row.rowNumber,
        kind: row.kind,
        merchantOrderNo: row.merchantOrderNo,
        merchantRefundNo: row.merchantRefundNo ?? null,
        externalId: row.externalId ?? null,
        statementStatus: row.statementStatus,
        normalizedStatus: row.normalizedStatus,
        amount: row.amount,
        currency: row.currency,
        occurredAt: row.occurredAt ?? null,
        localRecordId: local?.id ?? null,
        localStatus: localStatus ?? null,
        differenceCodes: uniqueCodes as Prisma.InputJsonValue,
        differenceDetail: uniqueCodes.length ? uniqueCodes.join(", ") : null,
        reviewStatus: uniqueCodes.length ? "open" : "not_required",
        reviewReason: null,
        reviewedBy: null,
        reviewedAt: null
      };
    });
    const differenceRows = lineData.filter((row) => (row.differenceCodes as string[]).length > 0).length;
    try {
      const batch = await this.prisma.$transaction(async (tx) => {
        const created = await tx.paymentReconciliationBatch.create({
          data: {
            tenantId,
            workspaceId,
            provider: normalizedProvider,
            fileName: text(file.originalname, 180) || "payment-statement.csv",
            fileSha256,
            status: differenceRows ? "needs_review" : "matched",
            totalRows: lineData.length,
            matchedRows: lineData.length - differenceRows,
            differenceRows,
            importedBy: operator ?? null
          }
        });
        await tx.paymentReconciliationLine.createMany({ data: lineData.map((row) => ({ ...row, batchId: created.id })) });
        return created;
      });
      return this.getBatch(tenantId, workspaceId, batch.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrent = await this.prisma.paymentReconciliationBatch.findFirst({ where: { tenantId, workspaceId, provider: normalizedProvider, fileSha256 } });
        if (concurrent) return this.getBatch(tenantId, workspaceId, concurrent.id);
      }
      throw error;
    }
  }

  async listBatches(tenantId: string, workspaceId: string, limit = 50): Promise<PaymentStatementBatchSummary[]> {
    const rows = await this.prisma.paymentReconciliationBatch.findMany({
      where: { tenantId, workspaceId },
      orderBy: { importedAt: "desc" },
      take: Math.max(1, Math.min(Math.floor(limit) || 50, 100))
    });
    return rows.map((row) => this.toBatchSummary(row));
  }

  async getBatch(tenantId: string, workspaceId: string, batchId: string): Promise<PaymentStatementBatchDetail> {
    const row = await this.prisma.paymentReconciliationBatch.findFirst({
      where: { id: batchId, tenantId, workspaceId },
      include: { lines: { orderBy: { rowNumber: "asc" } } }
    });
    if (!row) throw new NotFoundException("对账文件批次不存在或不属于当前经营空间");
    return {
      ...this.toBatchSummary(row),
      lines: row.lines.map((line) => this.toLineSummary(line))
    };
  }

  async reviewLine(tenantId: string, workspaceId: string, batchId: string, lineId: string, input: ReviewPaymentStatementLineRequest, operator?: string) {
    const reason = input.reason?.trim();
    if (!reason || reason.length > 500) throw new BadRequestException("对账差异处理原因不能为空且不能超过 500 个字符");
    if (!(["acknowledge", "query_provider"] as string[]).includes(input.decision)) throw new BadRequestException("不支持的对账差异处理动作");
    const line = await this.prisma.paymentReconciliationLine.findFirst({ where: { id: lineId, batchId, batch: { tenantId, workspaceId } } });
    if (!line) throw new NotFoundException("对账差异行不存在或不属于当前经营空间");
    if (line.reviewStatus === "acknowledged" && input.decision === "acknowledge") return this.getBatch(tenantId, workspaceId, batchId);
    const nextStatus: PaymentStatementReviewStatus = input.decision === "acknowledge" ? "acknowledged" : "query_pending";
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.paymentReconciliationLine.updateMany({
        where: { id: lineId, batchId, reviewStatus: { in: ["open", "query_pending"] } },
        data: { reviewStatus: nextStatus, reviewReason: reason, reviewedBy: operator ?? null, reviewedAt: new Date() }
      });
      if (updated.count !== 1) throw new ConflictException("对账差异已被其他操作处理，请刷新后重试");
      if (nextStatus === "acknowledged") {
        const remaining = await tx.paymentReconciliationLine.count({
          where: {
            batchId,
            reviewStatus: { in: ["open", "query_pending"] }
          }
        });
        await tx.paymentReconciliationBatch.updateMany({
          where: { id: batchId, tenantId, workspaceId },
          data: { acknowledgedRows: { increment: 1 }, status: remaining === 0 ? "reviewed" : "needs_review" }
        });
      }
    });
    return this.getBatch(tenantId, workspaceId, batchId);
  }

  private toBatchSummary(row: { id: string; workspaceId: string; provider: string; fileName: string; fileSha256: string; status: string; totalRows: number; matchedRows: number; differenceRows: number; acknowledgedRows: number; importedBy: string | null; importedAt: Date }): PaymentStatementBatchSummary {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      provider: row.provider as PaymentStatementBatchSummary["provider"],
      fileName: row.fileName,
      fileSha256: row.fileSha256,
      status: row.status,
      totalRows: row.totalRows,
      matchedRows: row.matchedRows,
      differenceRows: row.differenceRows,
      acknowledgedRows: row.acknowledgedRows,
      importedBy: row.importedBy ?? undefined,
      importedAt: row.importedAt.toISOString()
    };
  }

  private toLineSummary(row: { id: string; batchId: string; rowNumber: number; kind: string; merchantOrderNo: string; merchantRefundNo: string | null; externalId: string | null; statementStatus: string; normalizedStatus: string; amount: Prisma.Decimal; currency: string; occurredAt: Date | null; localRecordId: string | null; localStatus: string | null; differenceCodes: Prisma.JsonValue; differenceDetail: string | null; reviewStatus: string; reviewReason: string | null; reviewedBy: string | null; reviewedAt: Date | null }): PaymentStatementLineSummary {
    return {
      id: row.id,
      batchId: row.batchId,
      rowNumber: row.rowNumber,
      kind: row.kind as PaymentStatementKind,
      merchantOrderNo: row.merchantOrderNo,
      merchantRefundNo: row.merchantRefundNo ?? undefined,
      externalId: row.externalId ?? undefined,
      statementStatus: row.statementStatus,
      normalizedStatus: row.normalizedStatus,
      amount: decimal(row.amount),
      currency: row.currency,
      occurredAt: row.occurredAt?.toISOString(),
      localRecordId: row.localRecordId ?? undefined,
      localStatus: row.localStatus ?? undefined,
      differenceCodes: jsonArray(row.differenceCodes),
      differenceDetail: row.differenceDetail ?? undefined,
      reviewStatus: row.reviewStatus as PaymentStatementReviewStatus,
      reviewReason: row.reviewReason ?? undefined,
      reviewedBy: row.reviewedBy ?? undefined,
      reviewedAt: row.reviewedAt?.toISOString()
    };
  }
}
