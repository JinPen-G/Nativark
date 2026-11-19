/** 原检查媒体入口保持错误身份与对象引用，字节解析复用公共单源。 */
import { createBoundedMediaReader } from "@rental-os/platform-server/media";
import { InspectionAssistError } from "./inspection-assist.validation";

export const INSPECTION_OBJECT_READER = Symbol('INSPECTION_OBJECT_READER');
export interface InspectionObjectReader {
  open(reference: { tenantId: string; workspaceId: string; fileAssetId: string; provider: string; storageKey: string },
    signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}

export const readInspectionMedia = createBoundedMediaReader(code => new InspectionAssistError(code));
