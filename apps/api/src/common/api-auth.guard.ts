/** 原全局 Guard 令牌的薄构造；同一实例拥有原私有票据及读后复验集合。 */
import { Injectable, Optional } from "@nestjs/common";
import * as contracts from "@rental-os/shared";
import { createRentalAuthorization } from "@rental-os/rental-core/http-auth";
import { AuthService } from "../modules/auth/auth.service";
import { ClientAuthService } from "../modules/client/client-auth.service";
import { ClientApiRateLimitService } from "../modules/client/client-api-rate-limit.service";
import { WorkspaceCapabilityService } from "../modules/rental-core/workspace-capability.service";
import { SubscriptionService } from "../modules/subscription/subscription.service";
import { PrismaService } from "../modules/database/prisma.service";
const authorization = createRentalAuthorization(contracts);
export const { isNewBusinessRoute, UNMATCHED_ROUTE_PERMISSION, PUBLIC_ROUTES, PUBLIC_ROUTE_PREFIXES, CLIENT_ROUTE_PREFIXES, isClientRoute, isClientPublicRoute, isTenantMembershipRoute, requiredPermissions } = authorization;
@Injectable()
export class ApiAuthGuard extends authorization.Guard {
  constructor(auth: AuthService, @Optional() capabilities?: WorkspaceCapabilityService,
    @Optional() clientAuth?: ClientAuthService, @Optional() clientRateLimit?: ClientApiRateLimitService,
    @Optional() database?: PrismaService, @Optional() subscription?: SubscriptionService) {
    super(auth, capabilities, clientAuth, clientRateLimit, database, subscription);
  }
}
