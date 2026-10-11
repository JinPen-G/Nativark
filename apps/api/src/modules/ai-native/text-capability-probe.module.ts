import { Module, type DynamicModule } from '@nestjs/common';
import { ProviderCapabilityService } from './provider-capability.service';
import { TextCapabilityProbeApplication, type TextCapabilityProbeDependencies } from './text-capability-probe.application';
import { composeAuthorizedTextProbeTaskProducer } from './prisma-text-probe-original-request.repository';

export const TEXT_CAPABILITY_PROBE_TASK_PRODUCER = Symbol('TEXT_CAPABILITY_PROBE_TASK_PRODUCER');

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

  /** Opt-in persisted original-request/task production. Publication and task
   * creation are explicit calls; registration never runs the probe. The host
   * must subsequently pass the fixed task/run to composeTextCapabilityProbeTask.
   * Reuse the SAME application, profile and single financial ledger. */
  static registerTaskProducer(dependencies: TextCapabilityProbeDependencies,
    producer: Omit<Parameters<typeof composeAuthorizedTextProbeTaskProducer>[1], 'probe'> & {
      db: Parameters<typeof composeAuthorizedTextProbeTaskProducer>[0];
    }): DynamicModule {
    if (!Object.is(producer.db, dependencies.db)) throw new Error('TEXT_PROBE_DATABASE_MISMATCH');
    const registered = this.register(dependencies);
    return { ...registered, providers: [...(registered.providers ?? []), {
      provide: TEXT_CAPABILITY_PROBE_TASK_PRODUCER, inject: [TextCapabilityProbeApplication],
      useFactory: (probe: TextCapabilityProbeApplication) => composeAuthorizedTextProbeTaskProducer(producer.db, {
        auth: producer.auth, credentials: producer.credentials, guard: producer.guard, probe,
        sceneVersion: producer.sceneVersion, priceVersion: producer.priceVersion, clock: producer.clock,
      }),
    }], exports: [...(registered.exports ?? []), TEXT_CAPABILITY_PROBE_TASK_PRODUCER] };
  }
}
