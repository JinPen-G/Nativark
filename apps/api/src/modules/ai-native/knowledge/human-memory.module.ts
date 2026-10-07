import { Module, type DynamicModule } from '@nestjs/common';
import { PersistentMemoryConsentService } from './persistent-memory-consent.service';

/** Opt-in human-session application service. No controller, model tool, worker,
 * global registration or default permissions. May be used without file ports.
 */
@Module({})
export class HumanMemoryModule {
  static register(ports: ConstructorParameters<typeof PersistentMemoryConsentService>[0]): DynamicModule {
    // Validate mandatory trusted dependencies before marking the module usable.
    const service = new PersistentMemoryConsentService(ports);
    return { module: HumanMemoryModule,
      providers: [{ provide: PersistentMemoryConsentService, useValue: service }],
      exports: [PersistentMemoryConsentService] };
  }
}
