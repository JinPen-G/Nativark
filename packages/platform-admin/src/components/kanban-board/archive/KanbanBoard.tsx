import { useCallback, useMemo, type KeyboardEvent } from 'react';
import { KanbanBoardRuntime } from './reference-runtime';
import { cloneCards, validateBoard } from './validation';
import type { KanbanBoardProps, KanbanCard } from './types';
import './tokens.css';
import './original.css';
import './dropdown-original.css';
import './integration.css';
export function KanbanBoard({ onCardsChange, className = '', ...props }: KanbanBoardProps) {
  validateBoard(props);
  const cards = useMemo(() => props.cards && cloneCards(props.cards), [props.cards]);
  const defaultCards = useMemo(() => props.defaultCards && cloneCards(props.defaultCards), [props.defaultCards]);
  const change = useCallback((cards: KanbanCard[]) => onCardsChange?.(cloneCards(cards)), [onCardsChange]);
  const navigate = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const target = event.target as HTMLElement, group = target.closest('[role=radiogroup]');
    if (!group || target.getAttribute('role') !== 'radio') return;
    const choices = [...group.querySelectorAll<HTMLButtonElement>('[role=radio]')], current = choices.indexOf(target as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (current + (event.key === 'ArrowLeft' ? -1 : 1) + choices.length) % choices.length;
    event.preventDefault(); choices[next].click(); choices[next].focus();
  }, []);
  return <div className="kanban-board-local" onKeyDown={navigate}><KanbanBoardRuntime {...props} currentUser={props.currentUser ?? props.people?.[0]?.id} cards={cards} defaultCards={defaultCards} onCardsChange={change} className={className} /></div>;
}
export type { KanbanBoardProps, KanbanCard, KanbanPerson, KanbanColumn, ChecklistItem } from './types';
export default KanbanBoard;
