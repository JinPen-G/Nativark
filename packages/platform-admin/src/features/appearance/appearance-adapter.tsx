/** 原设置页的可选配置面板。未选助手时只保留原 section；不产生配置保存或 AI 执行。 */
import type { ComponentType, ReactNode } from "react";
import type { TenantAppearanceProfile } from "@rental-os/platform-contracts";
import { PageHeading, type PageHeadingProps } from "../../components/PageHeading";
import { AnimatedIcon } from "../../components/ui/AnimatedIcon";
import { useAdminSession } from "../../runtime";
import { resolveAdminBrandName } from "../../app/branding";
export interface AppearanceSectionProps {
  id: string; title: string;
  fields: { key: string; label: string; value: string; options?: { value: string; label: string }[] }[];
  onFill?: (values: Record<string, string>) => void; children: ReactNode;
}
export interface AppearancePageProps {
  PageHeader?: ComponentType<Omit<PageHeadingProps, "brandName" | "icon">>;
  CopilotSection?: ComponentType<AppearanceSectionProps>;
  onAccountThemeSaved?: (themeColor?: string) => void | Promise<void>;
  onTenantAppearanceSaved?: (profile: TenantAppearanceProfile) => void | Promise<void>;
}
export function AppearanceHeading(props: Omit<PageHeadingProps, "brandName" | "icon">) {
  const { tenant, user } = useAdminSession();
  return <PageHeading {...props} brandName={resolveAdminBrandName(tenant, user)} icon={<AnimatedIcon name="rules" />} />;
}
export function AppearanceSection({ id, title, children }: AppearanceSectionProps) {
  return <section data-copilot-anchor={id} data-copilot-record={"configuration:" + id} data-copilot-config={id} data-copilot-label={title} aria-label={title}>{children}</section>;
}
