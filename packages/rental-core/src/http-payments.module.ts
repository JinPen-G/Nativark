/** Rental 的原支付回调、退款和对账 HTTP 组合。
 * 宿主提供同一支付、对账与经营空间解析实例、全局 Guard 和审计；本模块不执行付款或启动作业。 */
import { Module, type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import { RENTAL_PAYMENT_HTTP, type RentalPaymentHttpApplications } from "./http-payment-applications";
import { PaymentWebhookController } from "./http-payment-webhook.controller";
import { PaymentOperationsController } from "./http-payment-operations.controller";
import { PaymentReconciliationController } from "./http-payment-reconciliation.controller";

export interface RentalPaymentHttpRegistration
  extends Pick<FactoryProvider<RentalPaymentHttpApplications>, "inject" | "useFactory"> {
  imports?: ModuleMetadata["imports"];
}

export const RENTAL_PAYMENT_HTTP_CONTROLLERS = [
  PaymentWebhookController, PaymentOperationsController, PaymentReconciliationController,
];
const APPLICATIONS = Symbol("rental.http.payment-applications");
const bindings = (Object.keys(RENTAL_PAYMENT_HTTP) as Array<keyof RentalPaymentHttpApplications>).map(key => ({
  provide: RENTAL_PAYMENT_HTTP[key],
  inject: [APPLICATIONS],
  useFactory: (applications: RentalPaymentHttpApplications) => {
    const application = applications[key];
    if (application == null) throw new Error(`缺少Rental支付HTTP应用：${key}`);
    return application;
  },
}));

@Module({})
export class RentalPaymentsHttpModule {
  static register(applications: RentalPaymentHttpApplications): DynamicModule {
    return this.registerFactory({ useFactory: () => applications });
  }

  static registerFactory(options: RentalPaymentHttpRegistration): DynamicModule {
    return {
      module: RentalPaymentsHttpModule,
      imports: options.imports,
      controllers: RENTAL_PAYMENT_HTTP_CONTROLLERS,
      providers: [{ provide: APPLICATIONS, inject: options.inject, useFactory: options.useFactory }, ...bindings],
      exports: bindings.map(binding => binding.provide),
    };
  }
}
