import { Module, type DynamicModule } from '@nestjs/common';
import { ProviderCapabilityService } from './provider-capability.service';
import { TextCapabilityProbeApplication, type TextCapabilityProbeDependencies } from './text-capability-probe.application';
import { composeAuthorizedTextProbeTaskProducer } from './prisma-text-probe-original-request.repository';
import { composePersistedTextProbeWorkflow } from './text-capability-probe-task.composition';
import { composeAuthorizedPersistedTextProbeWorkflow, type AuthorizedTextProbeWorkflowDependencies } from './text-capability-probe.composition';
import { TextCapabilityProbeRequestFactory, type TextCapabilityRequestDependencies } from './text-capability-probe-request.factory';
import { TextCapabilityProbeController, TEXT_CAPABILITY_PROBE_REQUESTS } from './text-capability-probe.controller';

export const TEXT_CAPABILITY_PROBE_TASK_PRODUCER = Symbol('TEXT_CAPABILITY_PROBE_TASK_PRODUCER');
export const TEXT_CAPABILITY_PROBE_WORKFLOW = Symbol('TEXT_CAPABILITY_PROBE_WORKFLOW');
const AUTHORIZED_TEXT_PROBE_ROOT = Symbol('AUTHORIZED_TEXT_PROBE_ROOT');

/** Explicit server composition. Import/register creates no HTTP route, timer,
 * probe or provider call. The host supplies current authority and held execution
 * evidence; the original Gateway still owns admission and the single ledger. */
@Module({})
export class TextCapabilityProbeModule {
  /** Standalone opt-in registration. The standard application reuses the same
   * factory with separate trusted server configuration, default closed. Neither
   * registration seeds plan/action policies or budgets for the caller. */
  static registerHttp(options: { enabled?: boolean; dependencies?: TextCapabilityRequestDependencies } = {}): DynamicModule {
    if (options.enabled !== true) return { module: TextCapabilityProbeModule, controllers: [], providers: [] };
    if (!options.dependencies) throw new Error('TEXT_PROBE_REQUEST_DEPENDENCIES_REQUIRED');
    return { module: TextCapabilityProbeModule, controllers: [TextCapabilityProbeController], providers: [
      { provide: TEXT_CAPABILITY_PROBE_REQUESTS, useValue: new TextCapabilityProbeRequestFactory(options.dependencies) },
    ] };
  }
  /** Preferred real server root. One application/ledger/evidence instance;
   * explicit registration alone never publishes or starts a probe task. */
  static registerAuthorizedWorkflow(dependencies: AuthorizedTextProbeWorkflowDependencies): DynamicModule {
    type Root = ReturnType<typeof composeAuthorizedPersistedTextProbeWorkflow>;
    return { module: TextCapabilityProbeModule, providers: [
      { provide: AUTHORIZED_TEXT_PROBE_ROOT, useFactory: () => composeAuthorizedPersistedTextProbeWorkflow(dependencies) },
      { provide: TextCapabilityProbeApplication, inject: [AUTHORIZED_TEXT_PROBE_ROOT], useFactory: (root: Root) => root.application },
      { provide: TEXT_CAPABILITY_PROBE_WORKFLOW, inject: [AUTHORIZED_TEXT_PROBE_ROOT], useFactory: (root: Root) => root.workflow },
      { provide: ProviderCapabilityService, inject: [AUTHORIZED_TEXT_PROBE_ROOT], useFactory: (root: Root) => root.application.capabilities },
    ], exports: [TextCapabilityProbeApplication, TEXT_CAPABILITY_PROBE_WORKFLOW, ProviderCapabilityService] };
  }
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

  static registerWorkflow(dependencies: TextCapabilityProbeDependencies,
    workflow: Omit<Parameters<typeof composePersistedTextProbeWorkflow>[0], 'probe'>): DynamicModule {
    if (!Object.is(workflow.db, dependencies.db)) throw new Error('TEXT_PROBE_DATABASE_MISMATCH');
    const registered = this.register(dependencies);
    return { ...registered, providers: [...(registered.providers ?? []), {
      provide: TEXT_CAPABILITY_PROBE_WORKFLOW, inject: [TextCapabilityProbeApplication],
      useFactory: (probe: TextCapabilityProbeApplication) => composePersistedTextProbeWorkflow({ ...workflow, probe }),
    }], exports: [...(registered.exports ?? []), TEXT_CAPABILITY_PROBE_WORKFLOW] };
  }
}
