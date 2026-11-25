/** 原 Nest 令牌的薄适配：所有认证、一次性票据和会话租约均由同一 RentalAuthService 实例持有。 */
import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RentalAuthService } from "@rental-os/rental-core/auth-service";
export type { AuthAudience, WorkspaceAccessLease } from "@rental-os/rental-core/auth-service";
import { PlatformService } from "../platform/platform.service";
import { WorkspaceCapabilityService } from "../rental-core/workspace-capability.service";
import { TenantAppearanceProfileService } from "../client/tenant-appearance-profile.service";
import { AccountAppearanceService } from "../client/account-appearance.service";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class AuthService extends RentalAuthService {
  constructor(platformService: PlatformService, configService: ConfigService,
    @Optional() capabilities?: WorkspaceCapabilityService,
    @Optional() tenantAppearance?: TenantAppearanceProfileService,
    @Optional() accountAppearance?: AccountAppearanceService,
    @Optional() businessDatabase?: PrismaService) {
    super(platformService, configService, capabilities, tenantAppearance, accountAppearance, businessDatabase);
  }
}
