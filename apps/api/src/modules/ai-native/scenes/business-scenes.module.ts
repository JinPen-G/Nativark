import { Module, type DynamicModule } from '@nestjs/common';
import { composeAiAuthorizedBusinessTools } from '../tools/business-tools.composition';
import { composeAiPersistedOrderScene, type AiPersistedOrderSceneDependencies } from './persisted-order-scene.composition';

export const AI_BUSINESS_SCENES = Symbol('AI_BUSINESS_SCENES');
export const AI_PERSISTED_ORDER_SCENE = Symbol('AI_PERSISTED_ORDER_SCENE');
export type AiBusinessSceneDependencies = Parameters<typeof composeAiAuthorizedBusinessTools>[0];
export type AiBusinessScenes = ReturnType<typeof composeAiAuthorizedBusinessTools>;

/** Host opt-in only: no HTTP, AppModule, timer, worker or automatic reads.
 * Existing production services must be injected; this module supplies no
 * successful authority, entitlement, input store or provider defaults. */
@Module({})
export class AiBusinessScenesModule {
  /** Optional official order-input + AIN-07 consumer, not task creation or
   * policy provisioning. Factory invocation also performs no business action. */
  static registerPersistedOrder(dependencies: AiPersistedOrderSceneDependencies): DynamicModule {
    return {
      module: AiBusinessScenesModule,
      providers: [{ provide: AI_PERSISTED_ORDER_SCENE, useFactory: () => composeAiPersistedOrderScene(dependencies) }],
      exports: [AI_PERSISTED_ORDER_SCENE]
    };
  }

  static register(dependencies: AiBusinessSceneDependencies): DynamicModule {
    return {
      module: AiBusinessScenesModule,
      providers: [{ provide: AI_BUSINESS_SCENES, useFactory: () => composeAiAuthorizedBusinessTools(dependencies) }],
      exports: [AI_BUSINESS_SCENES]
    };
  }
}
