/** 原 Rental Web 宿主的唯一认证/请求适配；公共组件只消费验证后的最小会话。 */
import type { AdminRuntime } from "@rental-os/platform-admin/runtime";
import { useAuthStore } from "@/features/auth/authStore";
import { request } from "@/api/http";
import { currentSessionEpoch, currentSessionSignal } from "./queryClient";

export const adminRuntime: AdminRuntime = {
  getSession: useAuthStore.getState,
  subscribe: listener => useAuthStore.subscribe(listener),
  currentSessionEpoch,
  currentSessionSignal,
  request
};
