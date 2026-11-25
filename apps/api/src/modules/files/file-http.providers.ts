/** 原文件HTTP绑定宿主已有实例；列表ACL、客户范围与上传生命周期沿各自真实服务核验。 */
import type { Provider, Type } from "@nestjs/common";
import {
  RENTAL_FILES_LEDGER, RENTAL_FILES_STORAGE, RENTAL_FILES_DATABASE, RENTAL_FILES_CUSTOMER_AUTHORITY,
  type RentalFileLedgerHttpApplication, type RentalFileStorageHttpApplication,
  type RentalFileHttpDatabase, type RentalFileCustomerHttpAuthority
} from "@rental-os/rental-core/http-file-applications";
import { PrismaService } from "../database/prisma.service";
import { FileStorageRuntimeService } from "../integrations/file-storage.runtime.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { CustomerOperationsService } from "../platform/customer-operations.service";

export const RENTAL_FILE_HTTP_PROVIDERS: Provider[] = [
  { provide: RENTAL_FILES_LEDGER, useExisting: IntegrationsService satisfies Type<RentalFileLedgerHttpApplication> },
  { provide: RENTAL_FILES_STORAGE, useExisting: FileStorageRuntimeService satisfies Type<RentalFileStorageHttpApplication> },
  { provide: RENTAL_FILES_DATABASE, useExisting: PrismaService satisfies Type<RentalFileHttpDatabase> },
  { provide: RENTAL_FILES_CUSTOMER_AUTHORITY, useExisting: CustomerOperationsService satisfies Type<RentalFileCustomerHttpAuthority> }
];
