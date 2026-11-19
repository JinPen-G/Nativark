/** 原 Nest 运营集成入口，将当前配置、同一仓储和文件读取权威供给 Rental 单源应用。 */
import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RentalIntegrationApplication } from "@rental-os/rental-core/integration-runtime";
import { IntegrationsRepository } from "./integrations.repository";
import { FileBusinessAccessService } from "../files/file-business-access.service";

@Injectable()
export class IntegrationsService extends RentalIntegrationApplication {
  constructor(
    configService: ConfigService,
    integrationsRepository: IntegrationsRepository,
    @Optional() fileAccess?: FileBusinessAccessService
  ) {
    super(configService, integrationsRepository, fileAccess);
  }
}
