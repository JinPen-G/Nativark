/** 公共Nest容器中的单一Core应用与受控权限启动；构造不查库，登记完成后才开放HTTP。
 * 权限定义沿已核清单及固定参加者，角色、成员分配和原业务作业仍由所属宿主管理。 */
import { Module, type DynamicModule, type FactoryProvider, type ModuleMetadata, type OnModuleInit } from "@nestjs/common";
import { CoreManifestSchema, type CoreManifest, type CoreSessionContext, type CoreScopeObservation,
  type CoreHttpRegistry, type CoreHttpPolicy } from "@rental-os/core-contracts";
import { CORE_MANAGEMENT_APPLICATION, CoreManagementController } from "./core-management.controller";
import type { CoreManagementHttpApplication } from "./core-management.controller";
import { CORE_SESSION_READER, CoreSessionController } from "./core-session.controller";
import { CORE_SCOPE_READER, CoreScopeController } from "./core-scope.controller";
import { registerPlatformCorePermissions, type CorePermissionRegistrationParticipant,
  type CorePermissionRegistrationTransaction } from "./platform-core-permissions";

export const CORE_HOST_APPLICATION = Symbol("platform.core-host.application");
export interface CoreHostHttpApplication {
  management: CoreManagementHttpApplication;
  session(): Promise<CoreSessionContext>;
  scope(value: unknown): Promise<CoreScopeObservation>;
  http: CoreHttpRegistry;
  authorizeHttp(method: string, url: string): Promise<CoreHttpPolicy>;
}
type ApplicationFactory = Pick<FactoryProvider<CoreHostHttpApplication>, "inject" | "useFactory">;

export interface CoreHostPermissionRegistration {
  database: {
    $transaction<T>(consume: (transaction: CorePermissionRegistrationTransaction) => Promise<T>,
      options: { isolationLevel: "Serializable"; timeout: number }): Promise<T>;
  };
  manifests: readonly CoreManifest[];
  participants?: readonly CorePermissionRegistrationParticipant[];
  /** 没有独立宿主生命周期的组合在登记失败后释放自己的连接。 */
  onFailure?(): Promise<void>;
}

/** 一个宿主的一次登记；显式启动与Nest钩子共用原Promise，失败不自动重试。 */
export class CoreHostPermissionStartup implements OnModuleInit {
  private initialization?: Promise<void>;
  private stopping = false;
  private readonly manifests: readonly CoreManifest[];
  private readonly participants: readonly CorePermissionRegistrationParticipant[];

  constructor(private readonly registration?: CoreHostPermissionRegistration) {
    this.manifests = registration?.manifests.map(manifest => CoreManifestSchema.parse(manifest)) ?? [];
    this.participants = [...(registration?.participants ?? [])];
    if (!this.manifests.length && this.participants.length) throw new Error("零Core不能提供权限兼容参加者");
  }

  initialize(): Promise<void> {
    return this.initialization ??= this.registerPermissions();
  }

  onModuleInit(): Promise<void> { return this.initialize(); }

  /** 只阻止尚未开始的登记；在途事务仍由原Promise等待提交或回滚。 */
  stop(): void { this.stopping = true; }

  private async registerPermissions(): Promise<void> {
    if (!this.registration || !this.manifests.length) return;
    try {
      if (this.stopping) throw new Error("Core宿主正在停止权限登记");
      await this.registration.database.$transaction(
        transaction => registerPlatformCorePermissions(transaction, this.manifests, this.participants),
        { isolationLevel: "Serializable", timeout: 30_000 });
    } catch (error) {
      try { await this.registration.onFailure?.(); }
      catch (closingError) { throw new AggregateError([error, closingError], "Core权限登记失败且资源释放未完成"); }
      throw error;
    }
  }
}

@Module({})
export class CoreHostModule {
  /** 父模块provider不会自动进入子模块；imports须导出inject中的实际原服务或宿主工厂。 */
  static register(options: ApplicationFactory & {
    imports?: ModuleMetadata["imports"];
    permissions?: Pick<FactoryProvider<CoreHostPermissionStartup>, "inject" | "useFactory">;
  }): DynamicModule {
    return { module: CoreHostModule, imports: options.imports ?? [],
      controllers: [CoreManagementController, CoreSessionController, CoreScopeController],
      providers: [
        { provide: CORE_HOST_APPLICATION, inject: options.inject ?? [], useFactory: options.useFactory },
        { provide: CoreHostPermissionStartup, inject: options.permissions?.inject ?? [],
          useFactory: options.permissions?.useFactory ?? (() => new CoreHostPermissionStartup()) },
        { provide: CORE_MANAGEMENT_APPLICATION, inject: [CORE_HOST_APPLICATION], useFactory: (application: CoreHostHttpApplication) => application.management },
        { provide: CORE_SESSION_READER, inject: [CORE_HOST_APPLICATION], useFactory: (application: CoreHostHttpApplication) => application.session },
        { provide: CORE_SCOPE_READER, inject: [CORE_HOST_APPLICATION], useFactory: (application: CoreHostHttpApplication) => application.scope }
      ], exports: [CORE_HOST_APPLICATION, CoreHostPermissionStartup] };
  }
}
