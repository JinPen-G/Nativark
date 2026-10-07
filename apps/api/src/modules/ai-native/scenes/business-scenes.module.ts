import { Module, type DynamicModule } from '@nestjs/common';
import { composeAiAuthorizedBusinessTools } from '../tools/business-tools.composition';

export const AI_BUSINESS_SCENES = Symbol('AI_BUSINESS_SCENES');
export type AiBusinessSceneDependencies = Parameters<typeof composeAiAuthorizedBusinessTools>[0];
export type AiBusinessScenes = ReturnType<typeof composeAiAuthorizedBusinessTools>;

/** Host opt-in only: no HTTP, AppModule, timer, worker or automatic reads.
 * Existing production services must be injected; this module supplies no
 * successful authority, entitlement, input store or provider defaults. */
@Module({})
export class AiBusinessScenesModule {
  static register(dependencies: AiBusinessSceneDependencies): DynamicModule {
    return {
      module: AiBusinessScenesModule,
      providers: [{ provide: AI_BUSINESS_SCENES, useFactory: () => composeAiAuthorizedBusinessTools(dependencies) }],
      exports: [AI_BUSINESS_SCENES]
    };
  }
}
