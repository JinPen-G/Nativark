import { Module, type DynamicModule } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { TenantIntegrationService } from '../../integrations/tenant-integration.service';
import { TenantInspectionObjectReader } from '../../integrations/inspection-object-reader';
import { INSPECTION_OBJECT_READER, type InspectionObjectReader } from './inspection-media.reader';
import { InspectionAssistError } from './inspection-assist.validation';

/** Add to an explicitly opted-in server module alongside FileStorageRuntime.
 * No root registration or enabling unsupported model/media capabilities. */
export function createInspectionObjectReaderProvider(db: Pick<PrismaClient, 'fileAsset' | 'rentalOrder'>,
  integrations: Pick<TenantIntegrationService, 'runtimeConfig'>) {
  if (typeof db?.fileAsset?.findFirst !== 'function' || typeof db?.rentalOrder?.findFirst !== 'function'
    || typeof integrations?.runtimeConfig !== 'function') throw new InspectionAssistError('STORAGE_UNAVAILABLE');
  const reader: InspectionObjectReader = new TenantInspectionObjectReader(db, integrations);
  return { provide: INSPECTION_OBJECT_READER, useValue: reader };
}

/** Import only in a host that explicitly opts in to controlled media reading.
 * The host's FileStorageRuntime provider can inject the exported token. No
 * FileStorageRuntime/bootstrap/HTTP/worker is registered by this module. */
@Module({})
export class InspectionObjectReaderModule {
  static register(db: Pick<PrismaClient, 'fileAsset' | 'rentalOrder'>,
    integrations: Pick<TenantIntegrationService, 'runtimeConfig'>): DynamicModule {
    return { module: InspectionObjectReaderModule,
      providers: [createInspectionObjectReaderProvider(db, integrations)], exports: [INSPECTION_OBJECT_READER] };
  }
}
