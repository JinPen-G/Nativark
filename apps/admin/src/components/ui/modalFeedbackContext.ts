import { createContext } from "react";
import type { ModalFuncProps } from "antd";

export type ModalFeedbackHandle = { destroy: () => void; update: (patch: Partial<ModalFuncProps> | ((previous: ModalFuncProps) => ModalFuncProps)) => void; then: Promise<boolean>["then"] };
export type ModalFeedbackApi = { [K in "confirm" | "info" | "success" | "error" | "warning" | "warn"]: (config: ModalFuncProps) => ModalFeedbackHandle };

/** Keep the retained provider and refreshed page consumers on one context identity. */
export const ModalFeedbackContext = createContext<ModalFeedbackApi | null>(null);
