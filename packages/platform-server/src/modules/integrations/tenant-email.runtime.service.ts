/** 租户邮件运行端口；凭据只在服务端解密，测试不投递邮件。 */
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { TenantIntegrationService, type TenantIntegrationRuntimeConfig } from "./tenant-integration.service";
import { runSmtp, smtpConnection, SmtpDeliveryUnknownError, type SmtpMessage } from "./smtp-transport";
import { imapConnection, readImapMailbox } from "./imap-reader";

@Injectable()
export class TenantEmailRuntimeService {
  constructor(private readonly integrations: TenantIntegrationService) {}
  async configuration(tenantId: string) {
    const config = await this.integrations.runtimeConfig("email", tenantId);
    if (!config || config.provider !== "smtp") throw new ServiceUnavailableException("请先配置并验证默认 SMTP 邮箱");
    return config;
  }
  async testConnection(config: TenantIntegrationRuntimeConfig) {
    if (config.provider !== "smtp") throw new ServiceUnavailableException("邮件提供方尚未实现");
    try {
      const account = smtpConnection(config.settings, config.credentials);
      await runSmtp(account);
      if (config.settings.receiveEnabled === true) await readImapMailbox(imapConnection(config.settings, account), { testOnly: true });
    }
    catch (error) { throw new ServiceUnavailableException(error instanceof Error ? error.message : "邮箱连接验证失败"); }
    return config.settings.receiveEnabled === true ? "已验证 SMTP 发信与 IMAP 只读收信连接，未发送或修改任何邮件。" : "已验证 SMTP 加密连接与账号登录，未发送邮件。";
  }
  async send(config: TenantIntegrationRuntimeConfig, message: SmtpMessage) {
    try { return await runSmtp(smtpConnection(config.settings, config.credentials), message); }
    catch (error) {
      if (error instanceof SmtpDeliveryUnknownError) throw error;
      throw new ServiceUnavailableException(error instanceof Error ? error.message : "邮件发送失败");
    }
  }
}
