import { AiTaskRunner } from "./ai-task-runner.service";
import type { AiTaskRunnerDependencies } from "./ai-task-runner.ports";

/** Explicit composition helper. It is intentionally not registered in AppModule/Cron. */
export function createAiTaskRunner(dependencies: AiTaskRunnerDependencies): AiTaskRunner {
  return new AiTaskRunner(dependencies);
}
