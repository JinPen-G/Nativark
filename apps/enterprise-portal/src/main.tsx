/** Independent enterprise application; original UIArc adapters retain their source.
 * No operator application, credentials or business APIs are mounted here. */
import "antd/dist/reset.css";
import "@/registry/foundation.css";
import "@/styles.css";
import "@/components/ui/arc-bridge.css";
import "@/components/ui/input-radius.css";
import "@/components/ui/input-colors.css";
import "@/components/ui/control-metrics.css";
import "@/components/ui/status-colors.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyMotionPreference, isMotionReduced } from "@/app/motionPreferences";
import { MotionGlobalConfig } from "motion/react";
import { App } from "./App";
import { captureEnterpriseInvite } from "@rental-os/web-client";
// Capture before authentication can replace this document; storage errors never log the code.
try { captureEnterpriseInvite(); } catch { /* The join page explains that the original invitation must be reopened. */ }
applyMotionPreference();
MotionGlobalConfig.skipAnimations = isMotionReduced();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
