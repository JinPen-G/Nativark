/** Rental compatibility constructor sharing the public configuration repository.
 * The explicit selected-host adapter preserves the original legacy behavior. */
import { PrismaPlatformModelConnection as Connection } from '../configuration/platform-model-connection';
import { beginPlatformAiManagementTransaction } from './platform-management-transaction';
export type { PlatformConnectionAuthority } from '../configuration/platform-model-connection';
export class PrismaPlatformModelConnection extends Connection {
  constructor(db: ConstructorParameters<typeof Connection>[0], scopes: ConstructorParameters<typeof Connection>[1],
    authority: ConstructorParameters<typeof Connection>[2], secrets: ConstructorParameters<typeof Connection>[3],
    readScopes?: ConstructorParameters<typeof Connection>[4]) {
    super(db, scopes, authority, secrets, readScopes, beginPlatformAiManagementTransaction);
  }
}
