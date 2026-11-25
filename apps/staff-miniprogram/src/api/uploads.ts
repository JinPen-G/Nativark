/** 员工附件动作沿 Rental Core 正式入口，微信字节读写保留在本宿主。 */
import { createRentalStaffUploadsApi, type StaffUploadHooks } from "@rental-os/rental-core/clients/staff";
export type { StaffUploadStage, StaffUploadReference, StaffUploadHooks, LocalStaffImage } from "@rental-os/rental-core/clients/staff";
import { newKey } from "../core/keys";
import { request } from "../core/http";
import { isStaffUploadObservationRequest, isStaffUploadObservationResponse, staffUploadObservationRoute } from "../components/ai-native/inspection-wire";

const assertCurrent = (hooks: StaffUploadHooks) => { if (hooks.current && !hooks.current()) throw new Error('当前页面已改变，原上传仅可按原引用核对'); };

function readFile(path: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: path,
      success: (result) => {
        if (result.data instanceof ArrayBuffer) resolve(result.data);
        else reject(new Error("读取文件失败"));
      },
      fail: () => reject(new Error("读取文件失败，请重新选择"))
    });
  });
}

function putFile(url: string, headers: Record<string, string>, data: ArrayBuffer, hooks: StaffUploadHooks): Promise<void> {
  return new Promise((resolve, reject) => {
    assertCurrent(hooks);
    const task = wx.request({
      url,
      method: "PUT",
      data,
      header: headers,
      timeout: 60000,
      responseType: "text",
      success: (result) => { if (hooks.current && !hooks.current()) { reject(new Error('原上传结果待核对，页面已改变')); return; } hooks.onAbort?.(null);
        result.statusCode >= 200 && result.statusCode < 300 ? resolve() : reject(new Error(`文件存储上传失败（${result.statusCode}）`)); },
      fail: () => { if (!hooks.current || hooks.current()) hooks.onAbort?.(null); reject(new Error("原文件上传结果待核对，请保留原引用")); }
    });
    hooks.onAbort?.(() => task.abort());
  });
}

export const { observeOriginalStaffUpload, completeObservedStaffUpload, uploadStaffImage, staffUploadDownloadUrl } = createRentalStaffUploadsApi({
  newKey, request, isStaffUploadObservationRequest, isStaffUploadObservationResponse, staffUploadObservationRoute,
  readFile, putFile,
});
