import { Module, type DynamicModule } from '@nestjs/common';
import { composeAuthorizedPlatformCapabilityProbe } from './platform-capability-probe.composition';

export const PLATFORM_CAPABILITY_PROBE = Symbol('PLATFORM_CAPABILITY_PROBE');
export type PlatformCapabilityProbeComposition = ReturnType<typeof composeAuthorizedPlatformCapabilityProbe>;

/** Explicit opt-in module for the platform capability probe. Registration
 * WITHOUT dependencies mounts nothing: the composition requires the trusted
 * server profile/scene/price versions and a real current SaaS credential.
 * This module never starts tasks, seeds policies or registers HTTP routes. */
@Module({})
export class PlatformCapabilityProbeModule {
  static register(dependencies?: Parameters<typeof composeAuthorizedPlatformCapabilityProbe>[0]): DynamicModule {
    if (!dependencies) return { module: PlatformCapabilityProbeModule, providers: [], exports: [] };
    const composition = composeAuthorizedPlatformCapabilityProbe(dependencies);
    return { module: PlatformCapabilityProbeModule,
      providers: [{ provide: PLATFORM_CAPABILITY_PROBE, useValue: composition }],
      exports: [PLATFORM_CAPABILITY_PROBE] };
  }
}
