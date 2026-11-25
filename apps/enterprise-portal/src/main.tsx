/** 企业门户浏览器入口，加载公共呈现与门户样式后采用原邀请和动效设置。 */
import "@rental-os/platform-admin/styles";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyMotionPreference, isMotionReduced } from "@rental-os/platform-admin/motion";
import { MotionGlobalConfig } from "motion/react";
import { App } from "./App";
import { captureEnterpriseInvite } from "@rental-os/web-client";
// Capture before authentication can replace this document; storage errors never log the code.
try { captureEnterpriseInvite(); } catch { /* The join page explains that the original invitation must be reopened. */ }
applyMotionPreference();
MotionGlobalConfig.skipAnimations = isMotionReduced();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
