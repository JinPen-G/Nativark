/** 原Nest兼容provider，仅供给同一企业业务实例与事务；实现由Rental包维护。 */
import { Injectable } from "@nestjs/common";
import { EnterpriseMerchantOrderSubmissionService as Implementation } from "@rental-os/rental-core/mysql-enterprise-merchant-order-submission";
import { RentalBusinessService } from "../rental-core/rental-business.service";
import { RentalCoreService } from "../rental-core/rental-core.service";
import { RentalOrderConfirmationService } from "../rental-core/rental-order-confirmation.service";
import { EnterpriseMerchantDelegationService } from "./enterprise-merchant-delegation.service";

@Injectable()
export class EnterpriseMerchantOrderSubmissionService extends Implementation {
  constructor(sources: EnterpriseMerchantDelegationService, orders: RentalOrderConfirmationService, core: RentalCoreService, business: RentalBusinessService) {
    super(sources, orders, core, business);
  }
}
