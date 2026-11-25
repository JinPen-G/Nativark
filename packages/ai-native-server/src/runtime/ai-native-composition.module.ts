import type { AiNativeComponent, AiNativeWiring } from './ai-native-composition';
import { assertAiNativeWiring, inspectAiNativeWiring } from './ai-native-composition';
export interface AiNativeCompositionFactoryResult { components: Readonly<AiNativeWiring>; checks: ReturnType<typeof inspectAiNativeWiring>; ready: boolean; }
/** Internal factory only. Public AppModule/Controller/Cron registration remains coordinator-owned. */
export function createAiNativeComposition(wiring: Partial<AiNativeWiring>): AiNativeCompositionFactoryResult {
  const checks = inspectAiNativeWiring(wiring);
  if (checks.some(check => !check.enabled)) return { components: wiring as AiNativeWiring, checks, ready: false };
  assertAiNativeWiring(wiring);
  return { components: wiring as AiNativeWiring, checks, ready: true };
}
export type { AiNativeComponent };
