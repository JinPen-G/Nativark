/** Original workspace pricing constructor, backed by the shared call ledger. */
import { GatewayCallPricing } from './gateway-call-pricing';
import { PrismaGatewayInvocationBindings } from './prisma-gateway-invocation-bindings';

export class PrismaGatewayCallPricing extends GatewayCallPricing {
  constructor(db: ConstructorParameters<typeof GatewayCallPricing>[0], scopes: ConstructorParameters<typeof GatewayCallPricing>[1],
    version: string, clock: () => Date = () => new Date(), automaticByokMetering = false) {
    super(db, scopes, version, clock, automaticByokMetering, new PrismaGatewayInvocationBindings(db, scopes, clock));
  }
}
