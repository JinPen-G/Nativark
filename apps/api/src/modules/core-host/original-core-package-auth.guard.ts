/** 四组包管理的精确合同使用公共 operator 准入，其余请求沿同一原 Rental Guard。 */
import type { CanActivate, ExecutionContext, FactoryProvider } from "@nestjs/common";
import type { CorePackageAssembly } from "@rental-os/platform-core-host";
import { PlatformAuthGuard, matchableRequestPath } from "@rental-os/platform-server";
import { ApiAuthGuard } from "../../common/api-auth.guard";
import { AuthService } from "../auth/auth.service";
import { ORIGINAL_CORE_PACKAGE_ASSEMBLY } from "./original-core-package-assembly";

export class OriginalCorePackageAuthGuard implements CanActivate {
  private readonly packageGuard: PlatformAuthGuard;

  constructor(private readonly original: Pick<ApiAuthGuard, "canActivate">,
    auth: ConstructorParameters<typeof PlatformAuthGuard>[0],
    private readonly packages: CorePackageAssembly) {
    this.packageGuard = new PlatformAuthGuard(auth, packages.http);
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ method: string; url: string }>();
    const method = request.method.toUpperCase(), path = matchableRequestPath(request.url);
    if (this.packages.http.registered(method, path, "operator")) {
      return this.packageGuard.canActivate(context);
    }
    return this.original.canActivate(context);
  }
}

export const ORIGINAL_CORE_PACKAGE_AUTH_GUARD_PROVIDER: FactoryProvider<OriginalCorePackageAuthGuard> = {
  provide: OriginalCorePackageAuthGuard,
  inject: [ApiAuthGuard, AuthService, ORIGINAL_CORE_PACKAGE_ASSEMBLY],
  useFactory: (original: ApiAuthGuard, auth: AuthService, packages: CorePackageAssembly) =>
    new OriginalCorePackageAuthGuard(original, auth, packages)
};
