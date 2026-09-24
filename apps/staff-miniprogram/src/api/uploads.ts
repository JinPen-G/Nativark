import type { CompleteFileUploadRequest, CreateFileUploadSessionRequest, FileAssetSummary, FileDownloadUrlSummary, FileUploadSessionSummary } from "@rental-os/shared";
import { newKey } from "../core/keys";
import { authHeaders, request } from "../core/http";

export interface LocalStaffImage {
  path: string;
  size: number;
  fileName: string;
  mimeType: string;
}

function readFile(path: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: path,
      success: (result) => {
        if (result.data instanceof ArrayBuffer) resolve(result.data);
        else reject(new Error("读取图片失败"));
      },
      fail: () => reject(new Error("读取图片失败，请重新选择"))
    });
  });
}

function putFile(url: string, headers: Record<string, string>, data: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: "PUT",
      data,
      header: headers,
      timeout: 60000,
      responseType: "text",
      success: (result) => result.statusCode >= 200 && result.statusCode < 300 ? resolve() : reject(new Error(`文件存储上传失败（${result.statusCode}）`)),
      fail: () => reject(new Error("文件存储上传失败，请检查小程序已配置上传域名"))
    });
  });
}

export async function uploadStaffImage(input: {
  path: string;
  size: number;
  fileName: string;
  mimeType: string;
  businessType: "rental_order" | "rental_work_order";
  businessId: string;
  uploadScene: "pickup-evidence" | "return-evidence" | "handover-signature" | "work-order-evidence" | "offline-payment-proof";
  metadata?: Record<string, unknown>;
}): Promise<FileAssetSummary> {
  const body: CreateFileUploadSessionRequest = {
    businessModule: "rental-core",
    businessType: input.businessType,
    businessId: input.businessId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.size,
    uploadScene: input.uploadScene,
    idempotencyKey: newKey("staff-upload"),
    metadata: { source: "staff-miniprogram", ...(input.metadata ?? {}) }
  };
  const session = await request<FileUploadSessionSummary>("/uploads/sessions", { method: "POST", data: body });
  if (session.status !== "completed") {
    if (session.mode === "provider") {
      if (!session.uploadUrl) throw new Error("文件服务没有返回上传地址");
      await putFile(session.uploadUrl, session.uploadHeaders ?? {}, await readFile(input.path));
    }
    const completed = await request<FileAssetSummary>(`/uploads/sessions/${encodeURIComponent(session.sessionId)}/complete`, {
      method: "POST",
      data: {} satisfies CompleteFileUploadRequest
    });
    return completed;
  }
  return request<FileAssetSummary>(`/uploads/sessions/${encodeURIComponent(session.sessionId)}/complete`, { method: "POST", data: {} });
}

export async function staffUploadDownloadUrl(fileAssetId: string): Promise<string> {
  const result = await request<FileDownloadUrlSummary>(`/uploads/${encodeURIComponent(fileAssetId)}/download-url`);
  // 模拟存储只返回元数据接口地址，不是可供 <image> 读取的图片文件。
  return result.mode === "provider" ? result.downloadUrl : "";
}

/** Used only where a component cannot attach auth headers, e.g. an image preview. */
export function staffUploadAuthHeaders() {
  return authHeaders();
}
