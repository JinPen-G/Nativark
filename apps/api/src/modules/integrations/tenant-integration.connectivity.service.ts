import { ConflictException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type {
  SystemUserRow,
  TenantIntegrationCapability,
  TenantIntegrationProvider,
  TenantIntegrationTestResult
} from "@rental-os/shared";
import { FileStorageRuntimeService } from "./file-storage.runtime.service";
import { PaymentRuntimeService } from "./payment.runtime.service";
import { TenantIntegrationRuntimeService } from "./tenant-integration.runtime.service";
import { TenantIntegrationService } from "./tenant-integration.service";

const LIVE_TEST_COOLDOWN_MS = 30_000;

function safeFailureMessage(error: unknown) {
  // 本地材料校验（证书序列号、密钥长度等）抛出的是我们自己措辞的 ServiceUnavailableException，
  // 不含第三方原始响应，可以原样展示；其余错误只保留 HTTP 状态码，避免回显第三方内容。
  if (error instanceof ServiceUnavailableException && !/\bHTTP\s+\d{3}\b/iu.test(error.message)) return error.message;
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const status = raw.match(/\bHTTP\s+\d{3}\b/iu)?.[0];
  return status
    ? `第三方平台连接测试失败（${status}），请检查配置、权限和网络。`
    : "第三方平台连接测试失败，请检查配置、权限和网络。";
}

@Injectable()
export class TenantIntegrationConnectivityService {
  constructor(
    private readonly integrations: TenantIntegrationService,
    private readonly sms: TenantIntegrationRuntimeService,
    private readonly fileStorage: FileStorageRuntimeService,
    private readonly payment: PaymentRuntimeService
  ) {}

  async test(
    capability: TenantIntegrationCapability,
    provider: TenantIntegrationProvider,
    user?: SystemUserRow
  ): Promise<TenantIntegrationTestResult> {
    const config = await this.integrations.testConfig(capability, provider, user);
    const checkedAt = new Date();
    if (config.missingFields.length > 0) {
      const message = `配置不完整，请补齐：${config.missingFields.join("、")}`;
      await this.integrations.recordTestResult({
        tenantId: config.tenantId,
        configId: config.id,
        status: "failed",
        mode: "configuration",
        checkedAt,
        error: message
      });
      return {
        capability,
        provider,
        ok: false,
        mode: "configuration",
        message,
        checkedAt: checkedAt.toISOString(),
        missingFields: config.missingFields
      };
    }
    if (config.configurationError) {
      await this.integrations.recordTestResult({
        tenantId: config.tenantId,
        configId: config.id,
        status: "failed",
        mode: "configuration",
        checkedAt,
        error: config.configurationError
      });
      return {
        capability,
        provider,
        ok: false,
        mode: "configuration",
        message: config.configurationError,
        checkedAt: checkedAt.toISOString(),
        missingFields: []
      };
    }
    const claimed = await this.integrations.claimLiveTest({
      tenantId: config.tenantId,
      configId: config.id,
      startedAt: checkedAt,
      cooldownMs: LIVE_TEST_COOLDOWN_MS
    });
    if (!claimed) {
      throw new ConflictException("连接测试刚刚执行过，请 30 秒后再试");
    }

    try {
      const message = capability === "payment"
        ? await this.payment.testConnection(config)
        : capability === "sms"
          ? await this.sms.testConnection(config)
          : await this.fileStorage.testConnection(config);
      const recorded = await this.integrations.recordTestResult({
        tenantId: config.tenantId,
        configId: config.id,
        status: "passed",
        mode: "live",
        checkedAt,
        startedAt: checkedAt,
        error: undefined
      });
      if (!recorded) {
        return {
          capability,
          provider,
          ok: false,
          mode: "live",
          message: "配置已在测试期间变更，未采用旧测试结果，请重新测试。",
          checkedAt: checkedAt.toISOString(),
          missingFields: []
        };
      }
      return { capability, provider, ok: true, mode: "live", message, checkedAt: checkedAt.toISOString(), missingFields: [] };
    } catch (error) {
      const message = safeFailureMessage(error);
      await this.integrations.recordTestResult({
        tenantId: config.tenantId,
        configId: config.id,
        status: "failed",
        mode: "live",
        checkedAt,
        startedAt: checkedAt,
        error: message
      });
      return { capability, provider, ok: false, mode: "live", message, checkedAt: checkedAt.toISOString(), missingFields: [] };
    }
  }
}
