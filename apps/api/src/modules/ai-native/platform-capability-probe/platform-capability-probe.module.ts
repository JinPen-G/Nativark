import { Module, type DynamicModule } from '@nestjs/common';
import { composeAuthorizedPlatformCapabilityProbe } from './platform-capability-probe.composition';
import { PlatformCapabilityProbeRequestFactory, type PlatformCapabilityProbeRequestDependencies } from './platform-capability-probe-request.factory';
import { PlatformCapabilityProbeController, PLATFORM_CAPABILITY_PROBE_REQUESTS } from './platform-capability-probe.controller';
export { PLATFORM_CAPABILITY_PROBE_REQUESTS } from './platform-capability-probe.controller';

export const PLATFORM_CAPABILITY_PROBE = Symbol('PLATFORM_CAPABILITY_PROBE');
export type PlatformCapabilityProbeComposition = ReturnType<typeof composeAuthorizedPlatformCapabilityProbe>;

/** Explicit opt-in module for the platform capability probe. Registration
 * WITHOUT dependencies mounts nothing: the composition requires the trusted
 * server profile/scene/price versions and a real current SaaS credential.
 * Explicit dependency registration mounts HTTP routes. Module construction
 * never starts tasks, seeds policies or supplies a default execution grant. */
@Module({})
export class PlatformCapabilityProbeModule {
  static register(dependencies?: Parameters<typeof composeAuthorizedPlatformCapabilityProbe>[0]): DynamicModule {
    if (!dependencies) return { module: PlatformCapabilityProbeModule, providers: [], exports: [] };
    const composition = composeAuthorizedPlatformCapabilityProbe(dependencies);
    return { module: PlatformCapabilityProbeModule,
      controllers: [PlatformCapabilityProbeController],
      providers: [{ provide: PLATFORM_CAPABILITY_PROBE, useValue: composition },
        { provide: PLATFORM_CAPABILITY_PROBE_REQUESTS,
          useValue: new PlatformCapabilityProbeRequestFactory(dependencies as PlatformCapabilityProbeRequestDependencies) }],
      exports: [PLATFORM_CAPABILITY_PROBE, PLATFORM_CAPABILITY_PROBE_REQUESTS] };
  }
}
