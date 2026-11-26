/** 独立公共 Web 启动，默认空 Core；主题/样式/外壳由正式公共包维护。 */
import "@rental-os/platform-admin/styles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyMotionPreference, isMotionReduced } from "@rental-os/platform-admin/motion";
import { MotionGlobalConfig } from "motion/react";
import type { ComponentType } from "react";

export function mountPublicAdmin(App: ComponentType) {
  applyMotionPreference(); MotionGlobalConfig.skipAnimations = isMotionReduced();
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
}
