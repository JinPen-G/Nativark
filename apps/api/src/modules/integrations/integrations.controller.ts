/** 原运营 HTTP 构造入口，Rental 单源处理方法消费同一 IntegrationsService。 */
import { Controller } from "@nestjs/common";
import { IntegrationsController as RentalIntegrationsController } from "@rental-os/rental-core/http-integrations";
import { IntegrationsService } from "./integrations.service";

@Controller("integrations")
export class IntegrationsController extends RentalIntegrationsController {
  constructor(integrationsService: IntegrationsService) {
    super(integrationsService);
  }
}
