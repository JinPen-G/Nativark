/** Rental 租户集成业务参加者。原结算配置与支付、短信、文件依赖沿同一数据库和配置锁事务核验。 */
import { ConflictException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { RENTAL_CURRENCY_CODES, type RentalCurrency } from "./contracts";
import type { TenantIntegrationCapability, TenantIntegrationProvider } from "@rental-os/platform-contracts/tenant-integrations";
import type { TenantIntegrationBusinessParticipant, TenantIntegrationTransaction } from "@rental-os/platform-server/integration-store";
import { assertFileProviderCanDisable, assertFileProviderIdentityChange } from "@rental-os/platform-server/file-integration-dependencies";
export type RentalIntegrationBusinessStorage = Pick<PrismaClient, "rentalTenantBusinessSettings">;

type RentalIntegrationTransaction = Pick<Prisma.TransactionClient, "rentalPaymentIntent" | "rentalPaymentRefund" | "rentalNotificationLog">;

export class RentalIntegrationBusinessParticipant implements TenantIntegrationBusinessParticipant {
  constructor(private readonly prisma: RentalIntegrationBusinessStorage) {}


  /** 同一租户沿原经营空间设置读取结算币种，空间尚未创建时使用原 CNY 缺省。 */
  async settlementCurrency(tenantId: string): Promise<RentalCurrency> {
    const row = await this.prisma.rentalTenantBusinessSettings.findFirst({
      where: { tenantId },
      select: { settings: true },
      orderBy: { updatedAt: "desc" }
    });
    const settings = (row?.settings ?? {}) as { pricing?: { currency?: string } };
    const currency = settings.pricing?.currency;
    return currency && RENTAL_CURRENCY_CODES.includes(currency as RentalCurrency) ? (currency as RentalCurrency) : "CNY";
  }

  /**
   * 停用 provider 不能把仍在处理中的外部事实变成无法恢复的孤儿：
   * 支付要继续查单/补入账，短信要继续查回执，文件要继续下载或清理。
   * 已完成的历史记录不阻塞切换；未完成记录必须先恢复、迁移或处理完。
   */
  async assertCanDisableProvider(
    transaction: TenantIntegrationTransaction,
    tenantId: string,
    capability: TenantIntegrationCapability,
    provider: TenantIntegrationProvider
  ) {
    const tx = transaction as unknown as RentalIntegrationTransaction;
    if (capability === "payment") {
      const [intent, refund] = await Promise.all([
        tx.rentalPaymentIntent.findFirst({
          where: { tenantId, provider, status: { in: ["pending", "verified_pending_funding", "funding_failed"] } },
          select: { id: true }
        }),
        tx.rentalPaymentRefund.findFirst({
          where: { tenantId, provider, status: { in: ["pending", "accepted", "funding_pending"] } },
          select: { id: true }
        })
      ]);
      if (intent || refund) throw new ConflictException("该支付平台仍有未完成的支付或退款事实，请先查单/恢复后再停用");
      return;
    }
    if (capability === "sms") {
      const [pendingBound, pendingUnbound] = await Promise.all([
        tx.rentalNotificationLog.findFirst({
          where: {
            tenantId,
            channel: "sms",
            provider,
            status: { in: ["queued", "sent", "delivery_pending", "delivery_uncertain"] }
          },
          select: { id: true }
        }),
        // 新通知在真正选择服务商前会短暂使用 sms_pending。停用任一短信平台
        // 时必须保护这类队列，避免它在停用检查后才读到旧的默认平台配置。
        tx.rentalNotificationLog.findFirst({
          where: {
            tenantId,
            channel: "sms",
            provider: "sms_pending",
            status: { in: ["queued", "failed"] }
          },
          select: { id: true }
        })
      ]);
      if (pendingBound || pendingUnbound) throw new ConflictException("该短信平台仍有未完成或待核对的通知，请先处理完再停用");
      return;
    }
    await assertFileProviderCanDisable(transaction, tenantId, provider);
  }
  async assertProviderIdentityChange(transaction: TenantIntegrationTransaction, tenantId: string,
    capability: "payment" | "file", provider: TenantIntegrationProvider) {
    if (capability === 'file') {
      await assertFileProviderIdentityChange(transaction, tenantId, provider);
      return;
    }
    // transaction由原配置服务的同一数据库与行锁供给，支付仍沿原业务表读取。
    const tx = transaction as unknown as RentalIntegrationTransaction;
    const dependent = await tx.rentalPaymentIntent.findFirst({ where: { tenantId: tenantId, provider }, select: { id: true } })
        || await tx.rentalPaymentRefund.findFirst({ where: { tenantId: tenantId, provider }, select: { id: true } });
    if (dependent) throw new ConflictException('历史支付或退款仍依赖原商户配置，不能原位更换；需保留原商户恢复通路');
  }
}
