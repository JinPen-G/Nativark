/** 公共通知 HTTP 装配。宿主提供已有应用，模板、存储和实际发送继续归各自参加者。 */
import { Module, type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NOTIFICATIONS_HTTP_APPLICATION, type NotificationHttpApplication } from "./notifications-http.application";

@Module({})
export class NotificationsHttpModule {
  static register<Dependencies extends unknown[]>(options: {
    imports?: ModuleMetadata["imports"];
    inject?: FactoryProvider["inject"];
    useFactory: (...dependencies: Dependencies) => NotificationHttpApplication | Promise<NotificationHttpApplication>;
  }): DynamicModule {
    return {
      module: NotificationsHttpModule,
      imports: options.imports ?? [],
      controllers: [NotificationsController],
      providers: [{
        provide: NOTIFICATIONS_HTTP_APPLICATION,
        inject: options.inject ?? [],
        useFactory: options.useFactory
      }],
      exports: [NOTIFICATIONS_HTTP_APPLICATION]
    };
  }
}
