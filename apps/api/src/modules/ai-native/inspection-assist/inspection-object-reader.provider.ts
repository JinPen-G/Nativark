import type { PrismaClient } from '@prisma/client';
import type { TenantIntegrationService } from '../../integrations/tenant-integration.service';
import { TenantInspectionObjectReader } from '../../integrations/inspection-object-reader';
import { INSPECTION_OBJECT_READER, type InspectionObjectReader } from './inspection-media.reader';

/** Add to an explicitly opted-in server module alongside FileStorageRuntime.
 * No root registration or enabling unsupported model/media capabilities. */
export function createInspectionObjectReaderProvider(db: Pick<PrismaClient, 'fileAsset' | 'rentalOrder'>,
  integrations: Pick<TenantIntegrationService, 'runtimeConfig'>) {
  const reader: InspectionObjectReader = new TenantInspectionObjectReader(db, integrations);
  return { provide: INSPECTION_OBJECT_READER, useValue: reader };
}
