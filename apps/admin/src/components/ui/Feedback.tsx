import { ToastStack, ToastStackProvider, useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { ArcLocale } from "./ArcLocale";
import { useLocale } from "@/app/locale";
import type { ReactNode } from "react";

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  return <ToastStackProvider>{children}<ArcLocale><ToastStack label={t("操作提示")} className="rental-toast-viewport" position="bottom-right" /></ArcLocale></ToastStackProvider>;
}
export { useToastStack as useFeedback };
