import { ToastStack, ToastStackProvider, useToastStack } from "./ToastStack";
import { ArcLocale } from "./ArcLocale";
import { useLocale } from "@/app/locale";
import type { ReactNode } from "react";
import { ModalFeedbackProvider } from "./ModalProvider";

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  return <ToastStackProvider><ModalFeedbackProvider>{children}</ModalFeedbackProvider><ArcLocale><ToastStack label={t("操作提示")} className="rental-toast-viewport" position="bottom-right" /></ArcLocale></ToastStackProvider>;
}
export { useToastStack as useFeedback };
