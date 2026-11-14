/** Offline method admission belongs to Core's original registration/funding
 * transaction. This reads only the current workspace payment selection; callers
 * retain Guard, order visibility, evidence, amount and original-receipt checks. */
import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { DEFAULT_RENTAL_PAYMENT_METHODS, RENTAL_OFFLINE_PAYMENT_METHOD_CODES,
  RENTAL_PAYMENT_METHOD_CODES, type RentalOfflinePaymentMethod, type RentalPaymentMethod } from "@rental-os/shared";

/** Request shape only. A valid method code is not permission to record money. */
export function parseRentalOfflinePaymentMethod(requested?: RentalOfflinePaymentMethod): RentalOfflinePaymentMethod {
  const method = requested ?? "offline_cash";
  if (!RENTAL_OFFLINE_PAYMENT_METHOD_CODES.includes(method)) throw new BadRequestException("不支持的线下收款方式");
  return method;
}

export function assertRentalOfflinePaymentMethodEnabled(method: RentalOfflinePaymentMethod, configured?: readonly RentalPaymentMethod[]) {
  if (configured !== undefined && (!Array.isArray(configured) || configured.length > RENTAL_PAYMENT_METHOD_CODES.length
    || configured.some(value => !RENTAL_PAYMENT_METHOD_CODES.includes(value)) || new Set(configured).size !== configured.length))
    throw new ConflictException("经营空间收款方式配置无效");
  // Preserve the existing old-settings compatibility rule. Missing or empty
  // selections use the original defaults, never another workspace's settings.
  const enabled = configured?.length ? configured : DEFAULT_RENTAL_PAYMENT_METHODS;
  if (!enabled.includes(method)) throw new ConflictException("该线下收款方式尚未在经营空间设置中启用");
}

export async function assertCurrentOfflinePaymentMethod(
  tx: Prisma.TransactionClient, tenantId: string, workspaceId: string, method: RentalOfflinePaymentMethod
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ tenantId: string; workspaceId: string;
    paymentType: string | null; methodsType: string | null; methods: Prisma.JsonValue | null }>>(Prisma.sql`
    SELECT tenantId, workspaceId, JSON_TYPE(JSON_EXTRACT(settings, '$.payment')) AS paymentType,
      JSON_TYPE(JSON_EXTRACT(settings, '$.payment.enabledMethods')) AS methodsType,
      CASE WHEN JSON_TYPE(JSON_EXTRACT(settings, '$.payment.enabledMethods')) = 'ARRAY'
        AND JSON_LENGTH(JSON_EXTRACT(settings, '$.payment.enabledMethods')) <= ${RENTAL_PAYMENT_METHOD_CODES.length}
        AND OCTET_LENGTH(JSON_EXTRACT(settings, '$.payment.enabledMethods')) <= 1024
        THEN JSON_EXTRACT(settings, '$.payment.enabledMethods') ELSE NULL END AS methods
    FROM rental_tenant_business_settings WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
    LOCK IN SHARE MODE`);
  if (rows.length !== 1 || rows[0].tenantId !== tenantId || rows[0].workspaceId !== workspaceId || rows[0].paymentType !== "OBJECT")
    throw new ConflictException("经营空间收款设置尚不可用");
  const row = rows[0];
  if (row.methodsType === null && row.methods === null) {
    assertRentalOfflinePaymentMethodEnabled(method);
    return;
  }
  if (row.methodsType !== "ARRAY") throw new ConflictException("经营空间收款方式配置无效");
  let methods: unknown = row.methods;
  try { if (typeof methods === "string") methods = JSON.parse(methods); }
  catch { throw new ConflictException("经营空间收款方式配置无效"); }
  if (!Array.isArray(methods)) throw new ConflictException("经营空间收款方式配置无效");
  // The locking read is current even if an outer transaction already has an RR
  // snapshot. Settings writers must wait for the original money commit.
  assertRentalOfflinePaymentMethodEnabled(method, methods as RentalPaymentMethod[]);
}
