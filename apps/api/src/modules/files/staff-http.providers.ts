/** 原员工 HTTP 入口使用宿主已有的会话、数据库、存储和检查权威。 */
import type { Provider, Type } from "@nestjs/common";
import { RENTAL_STAFF_AUTH_APPLICATION, type RentalStaffAuthHttpApplication } from "@rental-os/rental-core/http-staff-auth";
import {
  RENTAL_STAFF_INSPECTION_EVIDENCE, RENTAL_STAFF_UPLOAD_OBSERVATION_PARSER, RENTAL_STAFF_UPLOADS_DATABASE,
  RENTAL_STAFF_UPLOADS_STORAGE, type RentalStaffInspectionEvidence, type RentalStaffUploadObservationParser,
  type RentalStaffUploadsDatabase, type RentalStaffUploadsStorage
} from "@rental-os/rental-core/http-staff-uploads";
import { PrismaInspectionEvidenceAuthority } from "../ai-native/inspection-assist/prisma-inspection-evidence.authority";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileStorageRuntimeService } from "../integrations/file-storage.runtime.service";
import { parseStaffUploadObservation } from "../integrations/file-upload.dto";

function existing<T>(token: symbol, source: Type<T>): Provider {
  return { provide: token, useExisting: source };
}

export const RENTAL_STAFF_HTTP_PROVIDERS: Provider[] = [
  existing<RentalStaffAuthHttpApplication>(RENTAL_STAFF_AUTH_APPLICATION, AuthService),
  existing<RentalStaffUploadsDatabase>(RENTAL_STAFF_UPLOADS_DATABASE, PrismaService),
  existing<RentalStaffUploadsStorage>(RENTAL_STAFF_UPLOADS_STORAGE, FileStorageRuntimeService),
  {
    provide: RENTAL_STAFF_UPLOAD_OBSERVATION_PARSER,
    useValue: parseStaffUploadObservation satisfies RentalStaffUploadObservationParser
  },
  {
    provide: RENTAL_STAFF_INSPECTION_EVIDENCE,
    inject: [{ token: PrismaInspectionEvidenceAuthority, optional: true }],
    useFactory: (evidence?: PrismaInspectionEvidenceAuthority): RentalStaffInspectionEvidence | undefined =>
      evidence ? { bind: value => evidence.bind(value) } : undefined
  }
];
