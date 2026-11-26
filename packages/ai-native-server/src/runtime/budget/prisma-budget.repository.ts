/** Compatibility participant for the same single ledger in the original Rental host. */
import { withAiTaskTransaction } from '../task-transaction-authority';
import { hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { beginTenantModelConfigurationTransaction, type TenantModelConfigurationTransactionParticipant } from '../tenant-model-config-transactions';
import type { WorkspaceGatewayContext } from '../model-gateway.ports';
import { beginPlatformAiManagementTransaction } from '../platform-management-transaction';
import { BudgetError } from './budget.ports';
import { PrismaBudgetLedgerRepository, type BudgetLedgerDatabase } from './prisma-budget-ledger.repository';

type SettingsAuthorization = { context: WorkspaceGatewayContext; participant: TenantModelConfigurationTransactionParticipant }
  | { platform: { actorId: string; scopeId: string } };

export class PrismaBudgetRepository extends PrismaBudgetLedgerRepository {
  constructor(db: BudgetLedgerDatabase, clock: () => Date = () => new Date(),
    settingsAuthorization?: SettingsAuthorization, recoveryTransactions?: 'original_task') {
    super(db, {
      async beginSettings(tx, key, settings, operation) {
        const authorization = settingsAuthorization && 'context' in settingsAuthorization
          ? settingsAuthorization : undefined;
        const platform = settingsAuthorization && 'platform' in settingsAuthorization
          ? settingsAuthorization.platform : undefined;
        if (hasRentalBusinessTenantFence() && settings.scope.kind === 'tenant' && (!authorization
          || authorization.context.tenantId !== settings.scope.tenantId)) throw new BudgetError('UNAVAILABLE');
        if (hasRentalBusinessTenantFence() && settings.scope.kind === 'platform' && (!platform
          || key.scopeKind !== 'PLATFORM' || key.scopeId !== platform.scopeId
          || operation && (operation.kind !== 'platform' || operation.actorId !== platform.actorId)))
          throw new BudgetError('UNAVAILABLE');
        return settings.scope.kind === 'tenant' && authorization
          ? await beginTenantModelConfigurationTransaction(tx, authorization.context, authorization.participant)
          : settings.scope.kind === 'platform' && platform
            ? await beginPlatformAiManagementTransaction(tx, platform.actorId) : undefined;
      },
      withTask(tx, stepId, action, work) {
        // Gateway settlement is original accounting. Explicit Task recovery
        // keeps its own transaction lease for release and reconciliation.
        return action === 'reserve' || action === 'dispatch' || recoveryTransactions === 'original_task'
          && (action === 'release' || action === 'reconcile')
          ? withAiTaskTransaction(tx, { kind: 'step', stepId }, work) : work();
      }
    }, clock);
  }
}
