/** 纯配置校验：不读环境文件、连接数据库、登记准入或执行迁移。 */
import { CORE_CONTRACT_VERSION, CoreDeploymentLockSchema, type CoreDeploymentLock } from "@rental-os/core-contracts";

export function selectCrmDeployment(input: CoreDeploymentLock) {
  const lock = CoreDeploymentLockSchema.parse(input);
  if (lock.cores.length !== 1 || lock.cores[0].manifest.id !== "crm" || lock.dataCapabilities?.length)
    throw new Error("此宿主须且仅选择 CRM Core；其他 Core 或 AI 数据能力需独立受控组合");
  if (lock.cores[0].manifest.scope.kind !== "tenant") throw new Error("CRM 宿主只接受租户范围的 CRM 包");
  return lock.cores[0];
}

export function requireCrmRuntime(lock: CoreDeploymentLock, nodeVersion = process.versions.node): void {
  selectCrmDeployment(lock);
  if (lock.platform.versions.node !== nodeVersion || lock.platform.versions.contract !== CORE_CONTRACT_VERSION)
    throw new Error("CRM 部署锁与当前 Node 或 Core 合同版本不一致");
}

export function crmListenOptions(environment: Readonly<Record<string, string | undefined>>) {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = environment[key];
    if (raw !== undefined && !/^\d+$/.test(raw)) throw new Error(`${key} 须为十进制非负整数`);
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} 超出允许范围`);
    return value;
  };
  return { port: integer("API_PORT", 3000, 1, 65535),
    trustProxyHops: integer("TRUST_PROXY_HOPS", 0, 0, Number.MAX_SAFE_INTEGER) };
}
