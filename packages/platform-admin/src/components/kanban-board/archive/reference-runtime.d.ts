import type { ComponentType } from 'react';
import type { KanbanBoardProps, KanbanCard, KanbanColumn, KanbanPerson } from './types';
export const KanbanBoardRuntime: ComponentType<KanbanBoardProps>;
export const sampleColumns: KanbanColumn[];
export const samplePeople: KanbanPerson[];
export const sampleCards: KanbanCard[];
export const cellKey: (column: string, lane?: string) => string;
export const parseCellKey: (key: string) => { column: string; lane?: string };
export const cardInCell: (card: KanbanCard, key: string) => boolean;
