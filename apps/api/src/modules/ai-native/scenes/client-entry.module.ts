import { Module, type DynamicModule } from '@nestjs/common';
import { AiClientEntryError } from './client-entry-action';
import { AI_CLIENT_ENTRY_APPLICATION, AiClientEntryController } from './client-entry.controller';
import { composeRequestBoundClientApplication, type AiClientRequestConfiguration,
  type AiClientRequestDependencies } from './client-request.application';
import { composeClientOriginalBookingFlow } from './client-original-booking-flow';
import { composeClientOriginalBookingHttp } from './client-original-booking-http.composition';

export const AI_CLIENT_ORIGINAL_BOOKING_FLOW = Symbol('AI_CLIENT_ORIGINAL_BOOKING_FLOW');

/** Inert until the server explicitly assembles dependencies and enables entry. */
@Module({})
export class AiClientEntryModule {
  static registerHttp(dependencies: AiClientRequestDependencies, configuration: AiClientRequestConfiguration): DynamicModule {
    const server = structuredClone(configuration);
    return { module: AiClientEntryModule, controllers: [AiClientEntryController],
      providers: [{ provide: AI_CLIENT_ENTRY_APPLICATION, useFactory: () => {
        if (!server?.entry?.enabled || !dependencies?.tasks || !dependencies.client || !dependencies.db
          || typeof dependencies.guard?.canActivate !== 'function') {
          throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_entry_dependencies_missing');
        }
        const application = composeRequestBoundClientApplication(dependencies, server);
        return Object.freeze({ ...application, ...composeClientOriginalBookingHttp(application) });
      } }, { provide: AI_CLIENT_ORIGINAL_BOOKING_FLOW, inject: [AI_CLIENT_ENTRY_APPLICATION],
        useFactory: (application: ReturnType<typeof composeRequestBoundClientApplication>) => composeClientOriginalBookingFlow(application)
      }], exports: [AI_CLIENT_ENTRY_APPLICATION, AI_CLIENT_ORIGINAL_BOOKING_FLOW] };
  }
}
