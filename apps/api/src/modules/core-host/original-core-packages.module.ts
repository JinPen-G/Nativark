/** 四组 Controller 从原服务组取得同一包管理实例，生命周期仍由原宿主管理。 */
import { CorePackageAssemblyModule, type CorePackageAssembly } from "@rental-os/platform-core-host";
import { OriginalApplicationServicesModule } from "../../application-services.module";
import { ORIGINAL_CORE_PACKAGE_ASSEMBLY } from "./original-core-package-assembly";

export const originalCorePackagesModule = CorePackageAssemblyModule.register({
  imports: [OriginalApplicationServicesModule],
  inject: [ORIGINAL_CORE_PACKAGE_ASSEMBLY],
  useFactory: (application: CorePackageAssembly) => application
});
