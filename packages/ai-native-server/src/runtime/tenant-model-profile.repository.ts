/** Rental compatibility constructor. Public hosts supply their own current
 * transaction participant through the model-configuration factory. */
import type { WorkspaceGatewayContext } from './model-gateway.ports';
import { PrismaTenantModelProfileRepository as Repository } from '../configuration/tenant-model-profile.repository';
import { beginTenantModelConfigurationTransaction, type TenantModelConfigurationTransactionParticipant } from './tenant-model-config-transactions';
export class PrismaTenantModelProfileRepository extends Repository {
  constructor(db: ConstructorParameters<typeof Repository<WorkspaceGatewayContext>>[0], authorize: ConstructorParameters<typeof Repository<WorkspaceGatewayContext>>[1],
    participant?: TenantModelConfigurationTransactionParticipant) {
    super(db, authorize, (transaction, context) => beginTenantModelConfigurationTransaction(transaction, context, participant));
  }
}
