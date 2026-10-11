import { Module, type DynamicModule } from '@nestjs/common';
import { ProviderCapabilityService } from './provider-capability.service';
import { TextCapabilityProbeApplication, type TextCapabilityProbeDependencies } from './text-capability-probe.application';

/** Explicit server composition. Import/register creates no HTTP route, timer,
 * probe or provider call. The host supplies current authority and held execution
 * evidence; the original Gateway still owns admission and the single ledger. */
@Module({})
export class TextCapabilityProbeModule {
  static register(dependencies: TextCapabilityProbeDependencies): DynamicModule {
    return { module: TextCapabilityProbeModule, providers: [
      { provide: TextCapabilityProbeApplication, useFactory: () => new TextCapabilityProbeApplication(dependencies) },
      { provide: ProviderCapabilityService, inject: [TextCapabilityProbeApplication],
        useFactory: (application: TextCapabilityProbeApplication) => application.capabilities },
    ], exports: [TextCapabilityProbeApplication, ProviderCapabilityService] };
  }
}
