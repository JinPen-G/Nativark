/** 原员工检查宿主适配，供给同一运输、会话与正式注册校验。 */
import { createRentalStaffInspectionTransport } from "@rental-os/rental-core/clients/staff";
import type {
  AiStaffInspectionHistoryRequest,
  AiStaffInspectionHistoryResponse,
  AiStaffInspectionReceiptHostRequest,
  AiInspectionDraftReadRequest,
} from "@rental-os/shared";
import type {
  InspectionRecognitionReference,
  StaffInspectionHost,
  StaffInspectionReceiptHost,
} from "./inspection-host";
import { validateInspectionWire } from "./inspection-wire";
import { request } from "../../core/http";
import { currentSession, contextVersion } from "../../core/session";

const transport = createRentalStaffInspectionTransport({
  request,
  currentSession,
  contextVersion,
  validateInspectionWire,
});

export const readStaffInspectionHistory: (
  value: AiStaffInspectionHistoryRequest,
) => Promise<AiStaffInspectionHistoryResponse> = transport.readStaffInspectionHistory;
export const createStaffInspectionReceiptHost: (
  value: AiStaffInspectionReceiptHostRequest,
) => Promise<StaffInspectionReceiptHost> = transport.createStaffInspectionReceiptHost;
export const createStaffInspectionTransportHost: (
  reference: AiInspectionDraftReadRequest,
  signatureFileAssetId?: string,
  recognitionReference?: InspectionRecognitionReference,
) => Promise<StaffInspectionHost> = transport.createStaffInspectionTransportHost;
