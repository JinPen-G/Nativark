/** Rental 门户文件材料客户端。原用途、原引用和材料核验沿现有业务，
 * 宿主供给持久化、字节 I/O 与生命周期，服务端复核权限和归档结果。 */
import type { FileAssetSummary, FileUploadSessionSummary } from "@rental-os/platform-contracts/files";
import type { EnterprisePaymentProofBasis, EnterpriseManagementRequestView } from "../../src/enterprise-workflows";
import type { RentalExchangeInspectionCustomerMaterial } from "../../src/exchange-inspection-preparation";
import type { EnterpriseBusinessClient } from "./client";
import type { EnterpriseContextValue } from "./session";

export type EnterpriseEvidenceUploadObservation = {
  state: "not_recorded" | "observed";
  session?: Omit<FileUploadSessionSummary, "uploadUrl" | "uploadHeaders">;
  file?: Pick<FileAssetSummary, "id" | "fileName" | "status">;
};
export type EnterpriseEvidenceUploadReference = {
  key: string;
  stage: "session" | "upload" | "complete";
  objectRevision?: string;
};
type EvidenceOwner = Pick<EnterpriseContextValue, "tenantCode" | "session" | "entry" | "selectedCorporateId">;
type UploadFile = { name: string; type: string; size: number };
type UploadTarget = { protocol: string; username: string; password: string };

export interface EnterpriseEvidenceUploadOptions {
  english: boolean;
  purpose: "authority" | "payment_proof";
  paymentProof?: EnterprisePaymentProofBasis;
  owner: EvidenceOwner;
}
export interface EnterpriseEvidenceUploadPorts<FileBody extends UploadFile, Target extends UploadTarget>
  extends Pick<EnterpriseBusinessClient, "read" | "write"> {
  assertLifetime: () => void;
  currentOwner: () => EvidenceOwner;
  currentProofKey: () => string | undefined;
  reference: () => EnterpriseEvidenceUploadReference | undefined;
  remember: (reference: EnterpriseEvidenceUploadReference) => void;
  observed: (observation: EnterpriseEvidenceUploadObservation) => void;
  finish: (fileId: string) => void;
  clearError: () => void;
  newKey: () => string;
  parseTarget: (url: string) => Target;
  putFile: (target: Target, file: FileBody, headers: Record<string, string> | undefined) => Promise<{ ok: boolean }>;
}

/** Decode the original opaque locator. Storage and reliable writes belong to the host. */
export function readEnterpriseEvidenceReference(raw: string | null): EnterpriseEvidenceUploadReference | undefined {
  if (!raw) return;
  const value = JSON.parse(raw);
  if (!value || typeof value.key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.key) || !["session", "upload", "complete"].includes(value.stage)) throw new Error("原文件引用不可读，不能重新上传");
  if (value.objectRevision !== undefined && (typeof value.objectRevision !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.objectRevision))) throw new Error("原文件对象修订不可核对");
  return { key: value.key, stage: value.stage, ...(value.objectRevision ? { objectRevision: value.objectRevision } : {}) };
}

export function createEnterpriseEvidenceUploadClient<FileBody extends UploadFile, Target extends UploadTarget>(
  options: EnterpriseEvidenceUploadOptions,
  ports: EnterpriseEvidenceUploadPorts<FileBody, Target>,
) {
  const { english, purpose, paymentProof, owner } = options;
  const proofMode = purpose === "payment_proof", proofKey = JSON.stringify(paymentProof);
  const endpoint = proofMode && paymentProof ? `/enterprise/corporates/${encodeURIComponent(paymentProof.corporateCustomerId)}/orders/${encodeURIComponent(paymentProof.orderId)}/payment-proof` : "/enterprise/authority";
  const storageKey = proofMode ? `rental-os:enterprise-payment-proof:${JSON.stringify([owner.tenantCode, owner.session?.customer.customerId, owner.selectedCorporateId, owner.session?.workspace?.workspaceCode, paymentProof?.orderId ?? "unselected"])}`
    : `rental-os:enterprise-authority:${JSON.stringify([owner.tenantCode, owner.session?.customer.customerId])}`;
  const { read, write, reference, remember, observed, finish, clearError, newKey, parseTarget, putFile } = ports;
  const current = () => {
    ports.assertLifetime();
    if (proofMode) {
      const latest = ports.currentOwner();
      const corporate = latest.entry?.corporates.find(row => row.corporateCustomerId === paymentProof?.corporateCustomerId);
      if (!paymentProof || ports.currentProofKey() !== proofKey || latest.selectedCorporateId !== paymentProof.corporateCustomerId
        || latest.session?.workspace?.workspaceCode !== paymentProof.workspaceCode || corporate?.permissionRevision !== paymentProof.permissionRevision
        || !["requests:manage", "orders:read", "finance:read"].every(action => corporate?.actions.some(permission => permission === action))
        || reference() && reference()!.objectRevision !== paymentProof.objectRevision) throw new Error("原费用回款凭证对象或权限已变化，请保留原引用 / Original payment-evidence scope changed");
    }
  };
  const readOriginal = async () => {
    const original = reference(); if (!original) throw new Error("缺少原上传引用");
    const result = await read<EnterpriseEvidenceUploadObservation>(`${endpoint}/upload-operations/${encodeURIComponent(original.key)}`); current();
    observed(result);
    if (result.state === "observed" && result.session?.mode === "provider" && result.session.status === "completed" && result.file?.status === "active") finish(result.file.id);
    return result;
  };
  const observe = async () => {
    const result = await readOriginal();
    if (reference() && (result.state !== "observed" || result.session?.status !== "pending_upload")) throw new Error(english ? "No completed original receipt; keep the reference and contact the merchant." : "尚无原归档完成收据；保留原引用并联系商户，不能重传。");
  };
  const completeOriginal = async (sessionId: string) => {
    const original = reference(); if (!original || original.stage !== "upload") throw new Error("原归档命令可能已发出，只能回读");
    // Persist before completion dispatch. Failure thereafter can never enable another completion POST.
    remember({ ...original, stage: "complete" }); current();
    const asset = await write<FileAssetSummary>(`${endpoint}/upload-sessions/${encodeURIComponent(sessionId)}/complete`, {}); current();
    if (asset.status !== "active") throw new Error("原文件尚未归档");
    finish(asset.id);
  };
  const completeObserved = async () => {
    const result = await readOriginal();
    if (!reference()) return;
    if (result.state !== "observed" || result.session?.mode !== "provider" || result.session.status !== "pending_upload") throw new Error("原会话尚不可核验归档");
    await completeOriginal(result.session.sessionId);
  };
  const upload = async (file: FileBody | undefined, disabled: boolean) => {
    if (!file || reference() || disabled) throw new Error("请先选择文件并核对原操作");
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type) || file.size < 1 || file.size > 20 * 1024 * 1024) throw new Error(english ? "Use PDF, PNG or JPEG, up to 20 MiB." : "请选择20MiB以内的PDF、PNG或JPEG。");
    const original: EnterpriseEvidenceUploadReference = { key: newKey(), stage: "session", ...(proofMode ? { objectRevision: paymentProof!.objectRevision } : {}) }; remember(original); clearError(); current();
    const session = await write<FileUploadSessionSummary>(`${endpoint}/upload-sessions`, { fileName: file.name, mimeType: file.type, sizeBytes: file.size, idempotencyKey: original.key,
      ...(proofMode ? { objectRevision: original.objectRevision } : {}) }); current();
    if (session.mode !== "provider" || session.status !== "pending_upload" || !session.uploadUrl) throw new Error("未取得真实上传能力，请查原会话");
    const target = parseTarget(session.uploadUrl);
    if (target.protocol !== "https:" || target.username || target.password) throw new Error("文件地址不可用");
    remember({ ...original, stage: "upload" }); current();
    const response = await putFile(target, file, session.uploadHeaders); current();
    if (!response.ok) throw new Error("原对象上传结果待核对，不能重传");
    await completeOriginal(session.sessionId);
  };
  return { storageKey, current, readOriginal, observe, completeObserved, upload };
}

export interface EnterpriseManagementEvidencePorts<Bytes extends { type: string; size: number }> {
  request: (path: string) => Promise<{ ok: boolean; blob: () => Promise<Bytes> }>;
  current: () => void;
  unavailable: () => Error;
  verified: (bytes: Bytes) => void;
}
export async function readEnterpriseManagementEvidence<Bytes extends { type: string; size: number }>(
  original: Pick<EnterpriseManagementRequestView, "id"> | undefined,
  fileId: string,
  ports: EnterpriseManagementEvidencePorts<Bytes>,
) {
  const { request, current: check, unavailable, verified } = ports;
  check();
  const response = await request(`/enterprise/management-requests/${encodeURIComponent(original!.id)}/files/${encodeURIComponent(fileId)}`);
  check();
  if (!response.ok) throw unavailable();
  const bytes = await response.blob(); check();
  if (!["application/pdf", "image/png", "image/jpeg"].includes(bytes.type) || bytes.size < 1 || bytes.size > 20 * 1024 * 1024) throw unavailable();
  verified(bytes);
}

export interface EnterpriseInspectionPhotoPorts {
  request: (path: string) => Promise<{ ok: boolean; headers: { get: (name: string) => string | null }; arrayBuffer: () => Promise<ArrayBuffer> }>;
  current: () => void;
  isReadCurrent: () => boolean;
  digest: (bytes: ArrayBuffer) => Promise<ArrayBuffer>;
  verified: (bytes: ArrayBuffer, mimeType: string) => void;
}
export async function readEnterpriseExchangeInspectionPhoto(
  material: Pick<RentalExchangeInspectionCustomerMaterial, "orderId" | "preparationId" | "preparationHash">,
  photo: RentalExchangeInspectionCustomerMaterial["photos"][number],
  ports: EnterpriseInspectionPhotoPorts,
) {
  const { request, current, isReadCurrent, digest: hash, verified } = ports;
  if (![material.orderId, material.preparationId, photo.fileAssetId].every(value => /^[A-Za-z0-9._:-]{1,191}$/u.test(value))
    || !/^[a-f0-9]{64}$/u.test(photo.contentHash)) throw new Error("原照片引用不可核对");
  const path = `/enterprise/orders/${encodeURIComponent(material.orderId)}/exchange-inspections/${encodeURIComponent(material.preparationId)}/photos/${encodeURIComponent(photo.fileAssetId)}?preparationHash=${encodeURIComponent(material.preparationHash)}`;
  const response = await request(path);
  current();
  const mimeType = response.headers.get("Content-Type")?.split(";")[0].trim();
  if (!response.ok || !mimeType || !["image/png", "image/jpeg"].includes(mimeType)) throw new Error("原照片读取不可用");
  const bytes = await response.arrayBuffer(); current();
  if (!isReadCurrent() || bytes.byteLength < 1 || bytes.byteLength > 20 * 1024 * 1024) throw new Error("原照片读取已取消或超出范围");
  const digest = new Uint8Array(await hash(bytes)); current();
  const contentHash = Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
  if (contentHash !== photo.contentHash || !isReadCurrent()) throw new Error("原照片字节与具体检查材料不一致");
  verified(bytes, mimeType);
}
