import type { ClientRuntimeOptions } from "@rental-os/platform-client-contracts";

/** 复制到独立 Core 宿主后，仅在这里导入该 Core 的正式客户贡献/会话工厂。 */
export function assembleCustomer(): (Omit<ClientRuntimeOptions, "surface"> & { brand: { name: string; primaryColor?: string } }) | undefined {
  // 正式适配尚未装配；不以示例数据、管理员会话或恒真准入替代。
  return undefined;
}
