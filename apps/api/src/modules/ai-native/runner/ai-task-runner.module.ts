import { AiTaskRunner } from "./ai-task-runner.service";
import type { AiTaskRunnerDependencies, AiTaskRunnerResourcePort } from "./ai-task-runner.ports";

/** Explicit composition helper. It is intentionally not registered in AppModule/Cron. */
export function createAiTaskRunner(dependencies: AiTaskRunnerDependencies): AiTaskRunner {
  return new AiTaskRunner(dependencies);
}

/** Opt-in persistent composition. No AppModule, worker or timer registration. */
export function createPersistentAiTaskRunner(dependencies: AiTaskRunnerDependencies & { resources: AiTaskRunnerResourcePort }): AiTaskRunner {
  if (!dependencies?.resources) throw new Error('AI_RESOURCE_UNAVAILABLE');
  return new AiTaskRunner(dependencies);
}
