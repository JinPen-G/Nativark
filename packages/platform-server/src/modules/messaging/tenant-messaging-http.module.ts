/** 公共消息 HTTP 装配。宿主显式提供三项真实应用，共用原实例及原提交/恢复机制。 */
import { Module, type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import { TenantOperatorInvitationsController } from "./tenant-operator-invitations.controller";
import { AcceptTenantOperatorInvitationController } from "./accept-operator-invitation.controller";
import { TenantDispatchController } from "./tenant-dispatch.controller";
import { TenantSupportEmailController } from "./tenant-support-email.controller";
import {
  TENANT_OPERATOR_INVITATIONS_HTTP_APPLICATION,
  TENANT_DISPATCH_HTTP_APPLICATION,
  TENANT_SUPPORT_EMAIL_HTTP_APPLICATION,
  type TenantMessagingHttpApplications
} from "./tenant-messaging-http.application";

const TENANT_MESSAGING_HTTP_APPLICATIONS = Symbol("platform.messaging.http-applications");

@Module({})
export class TenantMessagingHttpModule {
  static register<Dependencies extends unknown[]>(options: {
    imports?: ModuleMetadata["imports"];
    inject?: FactoryProvider["inject"];
    useFactory: (...dependencies: Dependencies) => TenantMessagingHttpApplications | Promise<TenantMessagingHttpApplications>;
  }): DynamicModule {
    return {
      module: TenantMessagingHttpModule,
      imports: options.imports ?? [],
      controllers: [TenantOperatorInvitationsController, AcceptTenantOperatorInvitationController,
        TenantDispatchController, TenantSupportEmailController],
      providers: [
        { provide: TENANT_MESSAGING_HTTP_APPLICATIONS, inject: options.inject ?? [], useFactory: options.useFactory },
        { provide: TENANT_OPERATOR_INVITATIONS_HTTP_APPLICATION, inject: [TENANT_MESSAGING_HTTP_APPLICATIONS],
          useFactory: (applications: TenantMessagingHttpApplications) => applications.invitations },
        { provide: TENANT_DISPATCH_HTTP_APPLICATION, inject: [TENANT_MESSAGING_HTTP_APPLICATIONS],
          useFactory: (applications: TenantMessagingHttpApplications) => applications.dispatch },
        { provide: TENANT_SUPPORT_EMAIL_HTTP_APPLICATION, inject: [TENANT_MESSAGING_HTTP_APPLICATIONS],
          useFactory: (applications: TenantMessagingHttpApplications) => applications.support }
      ],
      exports: [TENANT_OPERATOR_INVITATIONS_HTTP_APPLICATION, TENANT_DISPATCH_HTTP_APPLICATION,
        TENANT_SUPPORT_EMAIL_HTTP_APPLICATION]
    };
  }
}
