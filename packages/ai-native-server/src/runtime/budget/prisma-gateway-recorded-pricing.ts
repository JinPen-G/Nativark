/** Original workspace pricing constructor, backed by the same recorded rates. */
import { GatewayRecordedPricing } from './gateway-recorded-pricing';
import { PrismaGatewayInvocationBindings } from './prisma-gateway-invocation-bindings';

export class PrismaGatewayRecordedPricing extends GatewayRecordedPricing {
  constructor(db: ConstructorParameters<typeof GatewayRecordedPricing>[0], scopes: ConstructorParameters<typeof GatewayRecordedPricing>[1],
    clock: () => Date = () => new Date(), approvedCreditPolicies = false) {
    super(db, scopes, clock, approvedCreditPolicies, new PrismaGatewayInvocationBindings(db, scopes, clock));
  }
}
