import { AiTaskRunner } from "./ai-task-runner.service";
import type { AiTaskRunnerDependencies, AiTaskRunnerResourcePort } from "./ai-task-runner.ports";

/** 公共显式组合入口；不注册 AppModule、HTTP、Cron 或业务工具。 */
export function createAiTaskRunner(dependencies: AiTaskRunnerDependencies): AiTaskRunner {
  return new AiTaskRunner(dependencies);
}

/** Opt-in persistent composition. No AppModule, worker or timer registration. */
export function createPersistentAiTaskRunner(dependencies: AiTaskRunnerDependencies & { resources: AiTaskRunnerResourcePort }): AiTaskRunner {
  if (!dependencies?.resources) throw new Error('AI_RESOURCE_UNAVAILABLE');
  return new AiTaskRunner(dependencies);
}
