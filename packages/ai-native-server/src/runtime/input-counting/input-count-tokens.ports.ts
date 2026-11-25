/** Structural ports for the counting slice. BudgetServiceLike mirrors the
 * original BudgetService's public surface without binding the counting code to
 * the class identity, so the offline smoke can drive the real service with a
 * serial transaction stub. The original single ledger stays authoritative. */
export { BudgetError } from '../budget/budget.ports';
export type { BudgetAuthorizationSource } from '../budget/budget-dependency-adapters';
import type { BudgetRecord, BudgetReserveCommand } from '../budget/budget.ports';

export interface BudgetServiceLike {
  reserve(command: BudgetReserveCommand): Promise<BudgetRecord>;
  read(id: string, association: BudgetReserveCommand['association']): Promise<BudgetRecord | null>;
  dispatch(id: string, association: BudgetReserveCommand['association'], eventKey: string): Promise<BudgetRecord>;
  settle(id: string, association: BudgetReserveCommand['association'], eventKey: string, evidenceRef: string): Promise<BudgetRecord>;
  release(id: string, association: BudgetReserveCommand['association'], eventKey: string): Promise<BudgetRecord>;
  markUnknown(id: string, association: BudgetReserveCommand['association'], eventKey: string, reason: string): Promise<BudgetRecord>;
  reconcile(id: string, association: BudgetReserveCommand['association'], eventKey: string, evidenceRef: string): Promise<BudgetRecord>;
}
