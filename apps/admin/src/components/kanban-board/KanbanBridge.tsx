import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useLocale, type AdminTranslate } from "@/app/locale";
import type { KanbanCard, KanbanPerson } from "./archive/types";

export interface KanbanBusinessBridge {
  disabled: boolean;
  t: AdminTranslate;
  canCreate: (column: string) => boolean;
  onCreate: (column: string, assignee?: string) => void;
  cardLabel: (card: KanbanCard) => string;
  onOpen?: (id: string) => void;
  renderCard?: (card: KanbanCard, person?: KanbanPerson, lifted?: boolean) => ReactNode;
  renderDetails?: (card: KanbanCard, close: () => void) => ReactNode;
}

export const KanbanBridgeContext = createContext<KanbanBusinessBridge | null>(null);
export function useKanbanBridge() {
  const bridge = useContext(KanbanBridgeContext);
  if (!bridge) throw new Error("Kanban business adapter is required");
  return bridge;
}

export function useKanbanAnnouncement() {
  const { locale } = useLocale();
  const [announcement, setAnnouncement] = useState("");
  const announce = useCallback((text: string) => {
    if (locale === "en-US") { setAnnouncement(text); return; }
    setAnnouncement(text
      .replace(/^Picked up (.*)\.$/u, "已提起 $1。")
      .replace(/^(.*) returned\.$/u, "$1 已回到原位。")
      .replace(/^Dropped (.*) in (.*)\.$/u, "已放下 $1，目标 $2；以处理结果为准。")
      .replace(/^Lifted (.*)\. (.*), position (\d+)\. Use arrow keys to move, space to drop, escape to cancel\.$/u, "已提起 $1。$2，第 $3 位。方向键移动，空格放下，Escape 取消。")
      .replace(/^(.*), position (\d+)\.$/u, "$1，第 $2 位。"));
  }, [locale]);
  return [announcement, announce] as const;
}
