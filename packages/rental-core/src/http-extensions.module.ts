/** 独立 Rental 宿主选择的认证与员工订阅扩展。
 * 公共六项认证仍由 PlatformServerModule 提供；旧宿主已登记薄适配 Controller，不能重复导入本模块。
 * 这里只绑定原实例，不另建认证、订阅、Guard 或生命周期。 */
import { Module, type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import { RentalAuthExtensionsController, RENTAL_AUTH_EXTENSIONS_APPLICATION,
  type RentalAuthExtensionsHttpApplication } from "./http-auth-extensions.controller";
import { StaffSubscriptionController, RENTAL_STAFF_SUBSCRIPTION_APPLICATION,
  type RentalStaffSubscriptionHttpApplication } from "./http-staff-subscription.controller";

export interface RentalHttpExtensionsApplications {
  auth: RentalAuthExtensionsHttpApplication;
  subscriptions: RentalStaffSubscriptionHttpApplication;
}

export interface RentalHttpExtensionsRegistration
  extends Pick<FactoryProvider<RentalHttpExtensionsApplications>, "inject" | "useFactory"> {
  imports?: ModuleMetadata["imports"];
}

const APPLICATIONS = Symbol("rental.http.extensions-applications");
const bindings: FactoryProvider[] = [
  { provide: RENTAL_AUTH_EXTENSIONS_APPLICATION, inject: [APPLICATIONS],
    useFactory: (applications: RentalHttpExtensionsApplications) => {
      if (typeof applications?.auth?.switchWorkspace !== "function"
        || typeof applications.auth.resetLocalDemoPassword !== "function") {
        throw new Error("Rental 认证扩展缺少同一原认证实例");
      }
      return applications.auth;
    } },
  { provide: RENTAL_STAFF_SUBSCRIPTION_APPLICATION, inject: [APPLICATIONS],
    useFactory: (applications: RentalHttpExtensionsApplications) => {
      if (typeof applications?.subscriptions?.getStaffContext !== "function") {
        throw new Error("Rental 员工订阅扩展缺少同一原订阅实例");
      }
      return applications.subscriptions;
    } }
];

@Module({})
export class RentalHttpExtensionsModule {
  static register(applications: RentalHttpExtensionsApplications): DynamicModule {
    return this.registerFactory({ useFactory: () => applications });
  }

  static registerFactory(options: RentalHttpExtensionsRegistration): DynamicModule {
    return { module: RentalHttpExtensionsModule, imports: options.imports,
      controllers: [RentalAuthExtensionsController, StaffSubscriptionController],
      providers: [{ provide: APPLICATIONS, inject: options.inject, useFactory: options.useFactory }, ...bindings],
      exports: bindings.map(binding => binding.provide) };
  }
}
