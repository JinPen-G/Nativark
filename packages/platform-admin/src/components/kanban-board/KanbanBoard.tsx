import { useCallback, useMemo, type KeyboardEvent } from "react";
import { KanbanBoardRuntime } from "./archive/reference-runtime";
import { cloneCards, validateBoard } from "./archive/validation";
import { KanbanBridgeContext, type KanbanBusinessBridge } from "./KanbanBridge";
import type { KanbanBoardProps, KanbanCard } from "./archive/types";
import "./archive/original.css";
import "./archive/dropdown-original.css";
import "./integration.css";

export function KanbanBoard({ bridge, onCardsChange, ...props }: KanbanBoardProps & { bridge: KanbanBusinessBridge }) {
  validateBoard(props);
  const cards = useMemo(() => props.cards && cloneCards(props.cards), [props.cards]);
  const change = useCallback((next: KanbanCard[]) => onCardsChange?.(cloneCards(next)), [onCardsChange]);
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const target = event.target as HTMLElement;
    const group = target.closest('[role="radiogroup"]');
    if (!group || target.getAttribute("role") !== "radio") return;
    const choices = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const current = choices.indexOf(target as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (current + (event.key === "ArrowLeft" ? -1 : 1) + choices.length) % choices.length;
    event.preventDefault(); choices[next].click(); choices[next].focus();
  };
  return <KanbanBridgeContext.Provider value={bridge}><div className="rental-kanban" onKeyDown={navigate} aria-busy={bridge.disabled}>
    <KanbanBoardRuntime {...props} cards={cards} onCardsChange={change} />
  </div></KanbanBridgeContext.Provider>;
}
export type { KanbanBoardProps, KanbanCard, KanbanColumn, KanbanPerson } from "./archive/types";
