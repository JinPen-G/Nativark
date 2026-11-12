export type Environment = Record<string, string | undefined>;

export interface EnvironmentOptions {
  appDirectory?: string;
  mode?: string;
  env?: Environment;
}

export const PROJECT_ROOT: string;
export function environmentFiles(options?: EnvironmentOptions): string[];
export function readEnvironmentFile(file: string, options?: { required?: boolean }): Environment;
export function loadProjectEnvironment(options?: EnvironmentOptions): Environment;
export function validateApiEnvironment(input: Environment, options?: { release?: boolean }): Environment;
export function loadViteEnvironment(
  mode: string,
  appDirectory: string,
  loadEnv: (mode: string, directory: string, prefix: string) => Record<string, string>,
  options?: { offline?: boolean }
): Environment;
export function apiProxyTarget(env: Environment): string;
export function publicEnvironmentDefinitions(
  application: "admin" | "tenantWebsite" | "enterprisePortal",
  env: Environment
): Record<string, string>;
