/** 内置 Rental 能力的唯一显式组合，当前与仍被历史对象引用的版本一并登记。 */
import type { CapabilityHookRuntime } from "../capability-runtime";
import { buildCameraCompatibilityHookModule } from "./camera-compatibility";
import { buildCameraKitHandoverHookModule, CAMERA_KIT_HANDOVER_LEGACY_VERSION } from "./camera-kit-handover";
import { buildKitHandoverHookModule } from "./kit-handover";
import { buildCampingKitIntegrityHookModule } from "./camping-kit-integrity";
import { buildCampingCleaningTurnaroundHookModule } from "./camping-cleaning-turnaround";

export function registerRentalCapabilityHooks(runtime: Pick<CapabilityHookRuntime, "register" | "assertCurrentVersionsRegistered">) {
  runtime.register(buildCameraCompatibilityHookModule());
  // 旧空间和在途订单仍引用此版本，升级组合同时保留当前及原交接实现。
  runtime.register(buildCameraKitHandoverHookModule());
  runtime.register(buildCameraKitHandoverHookModule(CAMERA_KIT_HANDOVER_LEGACY_VERSION));
  runtime.register(buildKitHandoverHookModule());
  runtime.register(buildCampingKitIntegrityHookModule());
  runtime.register(buildCampingCleaningTurnaroundHookModule());
  runtime.assertCurrentVersionsRegistered();
}
