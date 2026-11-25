export interface KanbanColumn { id: string; name: string; limit?: number }
export interface KanbanPerson { id: string; name: string; avatar?: string }
export interface ChecklistItem { id: string; text: string; done: boolean }
export interface KanbanCard {
  id: string;
  title: string;
  column: string;
  assignee: string;
  label?: string;
  due?: string;
  points?: number;
  description?: string;
  checklist?: ChecklistItem[];
}
export interface KanbanBoardProps {
  columns?: KanbanColumn[];
  people?: KanbanPerson[];
  cards?: KanbanCard[];
  defaultCards?: KanbanCard[];
  onCardsChange?: (cards: KanbanCard[]) => void;
  defaultGroupBy?: 'status' | 'assignee';
  currentUser?: string;
  title?: string;
  className?: string;
}
