import { createContext, useContext } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, CirclePlay, FileCheck2, ListChecks,
  Mail, Plus, PlugZap, Save, Search, Send, Square, SquarePen, Trash2, Undo2, X, type LucideProps } from "lucide-react";
import { AnimatedIcon } from "./AnimatedIcon";
import type { ActionButtonIntent } from "./actionButtonIntent";

export const ActionButtonIconContext = createContext<ActionButtonIntent>("none");

/** Inserted only into the original Arc idle-glyph slot by actionButtonIconAdapter.
 * The upstream spinner, drawn check, lifecycle and motion still own every other state. */
export function ActionButtonIdleIcon({ width = 17, height = 17, className, style }: LucideProps) {
  const intent = useContext(ActionButtonIconContext);
  if (intent === "none") return null;
  if (intent === "refresh" || intent === "retry" || intent === "upload" || intent === "download") {
    return <AnimatedIcon name={intent === "retry" ? "refresh" : intent} className={className}
      style={{ width, height, ...style }} />;
  }
  const Icon = {
    save: Save, review: FileCheck2, search: Search, connect: PlugZap, create: Plus,
    submit: Send, confirm: Check, cancel: X, stop: Square, next: ChevronRight,
    previous: ChevronLeft, forward: ArrowRight, select: ListChecks, play: CirclePlay,
    notify: Mail, edit: SquarePen, delete: Trash2, undo: Undo2,
  }[intent];
  return <Icon aria-hidden="true" width={width} height={height} strokeWidth={1.75} className={className}
    style={{ flexShrink: 0, ...style }} data-action-icon={intent} />;
}
