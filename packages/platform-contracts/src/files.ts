/** 公共文件生命周期合同。业务对象归属、当前权限与冻结内容由服务端核验，客户端字段不授予文件访问。
 * 原shared/infrastructure兼容再导出同一声明；本入口不初始化存储或依赖行业Core。 */
export interface FileAssetSummary {
  id: string;
  businessModule: string;
  businessType: string;
  businessId?: string;
  fileName: string;
  fileExt?: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  /** 服务端内部对象键；对外接口不返回，保留为可选字段兼容内部 mock 数据。 */
  storageKey?: string;
  publicUrl?: string;
  uploadScene: string;
  status: "active" | "deleted" | string;
  uploadedBy?: string;
  createdAt: string;
}

export interface FileAssetQuery {
  businessModule?: string;
  businessType?: string;
  businessId?: string;
  uploadScene?: string;
  status?: string;
  limit?: number;
}

export interface CreateFileAssetRequest {
  businessModule: string;
  businessType: string;
  businessId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  uploadScene: string;
  uploadedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateFileUploadSessionRequest {
  businessModule: string;
  businessType: string;
  /** 上传必须绑定已存在的租户业务对象，禁止只凭调用方字符串制造孤儿文件。 */
  businessId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadScene: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface FileUploadSessionSummary {
  sessionId: string;
  fileAssetId: string;
  provider: string;
  mode: "provider" | "simulation";
  /** freeze_pending binds a one-time content write; only original completion
   * observation may resume it, never a new upload or PUT retry. */
  status: "pending_upload" | "freeze_pending" | "completed" | "failed" | string;
  /** Only the original still-pending staging object receives a PUT grant. */
  uploadUrl?: string;
  uploadHeaders?: Record<string, string>;
  expiresAt: string;
}

export interface FileUploadCleanupSummary {
  scanned: number;
  invalidated: number;
  deletedObjects: number;
  cleanupPending: number;
  sessionIds: string[];
}

export interface CompleteFileUploadRequest {
  /** Optional SHA-256 assertion for staged uploads; the server computes the
   * actual digest. It never treats this client field as content evidence. */
  checksum?: string;
}

export interface FileDownloadUrlSummary {
  fileAssetId: string;
  provider: string;
  mode: "provider" | "simulation";
  downloadUrl: string;
  expiresAt?: string;
}
