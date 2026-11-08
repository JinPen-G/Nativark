import type { KanbanBoardProps, KanbanCard } from './types';
function unique(items: { id: string }[]) { return new Set(items.map(item => item.id)).size === items.length; }
const validId = (id: unknown) => typeof id === 'string' && id.length > 0 && !/[|]/.test(id);
export function validateBoard(props: KanbanBoardProps) {
  if (props.columns && (!Array.isArray(props.columns) || props.columns.length === 0 || !props.columns.every(column => validId(column?.id) && typeof column.name === 'string' && (column.limit === undefined || Number.isInteger(column.limit) && column.limit >= 0)) || !unique(props.columns))) throw new TypeError('Columns require unique IDs, names and nonnegative WIP limits.');
  if (props.people && (!Array.isArray(props.people) || !props.people.every(person => validId(person?.id) && typeof person.name === 'string') || !unique(props.people))) throw new TypeError('People require unique IDs and names.');
  const cards = props.cards ?? props.defaultCards;
  if (cards && (!Array.isArray(cards) || !cards.every(card => validId(card?.id) && typeof card.title === 'string' && validId(card.column) && validId(card.assignee) && (!card.checklist || Array.isArray(card.checklist) && unique(card.checklist) && card.checklist.every(item => validId(item?.id) && typeof item.text === 'string' && typeof item.done === 'boolean'))) || !unique(cards))) throw new TypeError('Cards and checklist items require unique IDs and valid values.');
  if (cards && props.columns && cards.some(card => !props.columns!.some(column => column.id === card.column))) throw new TypeError('Every card column must exist on the board.');
  if (cards && props.people && cards.some(card => !props.people!.some(person => person.id === card.assignee))) throw new TypeError('Every card assignee must exist in people.');
  if (props.currentUser && props.people && !props.people.some(person => person.id === props.currentUser)) throw new TypeError('Current user must exist in people.');
}
export function cloneCards<T extends KanbanCard>(cards: T[]): T[] {
  return cards.map(card => ({ ...card, ...(card.checklist ? { checklist: card.checklist.map(item => ({ ...item })) } : {}) }));
}
