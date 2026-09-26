import { RightOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import { Alert, Button, Card, Descriptions, Empty, Space, Tag, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { APP_ROUTES } from "@/app/navigation";

/**
 * SUB-02 租户后台「版本与订阅」页（需求 §5）。
 *
 * 本轮为**静态骨架**：按 §5.2 的区块顺序与 §5.3 的按钮规则搭好结构，用占位文案；
 * 数据查询、真实按钮动作与金额待接总控 SUB-01 的只读契约（见 subscriptionTypes.ts 的 TODO）。
 * 占位一律「待平台确认 / 价格待公布 / 待确认」，绝不显示 0 元 / 永久有效（§5.2、§14.2）。
 */
const PLACEHOLDER = "待平台确认";

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useLocale();
  return <Card size="small" title={t(title)}>{children}</Card>;
}

export function TenantSubscriptionPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  // 进入页面用 :view；升级/续费/降级/不续费等写动作按钮用 :manage（§5.1 普通员工可看摘要、不默认可购买）。
  const canManage = useAuthStore((state) => state.hasPermission("rental-os:subscription:manage"));

  return (
    <PageHeader
      title="版本与订阅"
      description="当前租户全部适用经营空间共用同一版本、有效期与套餐；切换经营空间不影响本页。"
      note={{ title: "关于版本与订阅", description: "统一到期时间与权益由平台办理；金额、标准价与到期限制以平台确认为准，价格未发布时显示「价格待公布」。" }}
      view={
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          {!canManage && (
            <Alert type="info" showIcon message={t("你可查看版本与到期摘要；升级、续费、降级等办理需订阅管理权限，请联系租户管理员或平台。")} />
          )}

          <SectionCard title="当前版本与服务">
            <Descriptions column={{ xs: 1, md: 2 }} size="small" colon={false}
              items={[
                { key: "tenant", label: t("租户"), children: t(PLACEHOLDER) },
                { key: "edition", label: t("当前套餐版本"), children: <Tag>{t(PLACEHOLDER)}</Tag> },
                { key: "status", label: t("服务状态"), children: t(PLACEHOLDER) },
                { key: "source", label: t("来源"), children: t(PLACEHOLDER) },
                { key: "period", label: t("有效期（含时区）"), children: t("待平台确认（到期以精确截止时点为准，剩余天数仅辅助）") },
                { key: "amount", label: t("本期确认金额 / 办理日期"), children: t("待确认") }
              ]}
            />
          </SectionCard>

          <SectionCard title="当前操作">
            <Space wrap>
              <Button onClick={() => navigate(APP_ROUTES.subscriptionPro.path)}>{t("了解 PRO")}<RightOutlined /></Button>
              {/* TODO(SUB-01/03)：按 §5.3 依当前状态收敛按钮（PRO 隐藏重复升级、有未关闭申请改为「查看申请进度」）。写动作接管理员办理契约。 */}
              <Button type="primary" disabled={!canManage}>{t("升级 PRO")}</Button>
              <Button disabled={!canManage}>{t("续费")}</Button>
              <Button disabled={!canManage}>{t("申请下期基础版")}</Button>
              <Button disabled={!canManage}>{t("到期不续费")}</Button>
            </Space>
          </SectionCard>

          <SectionCard title="版本功能对比">
            <Space orientation="vertical" size={8} style={{ width: "100%" }}>
              <Typography.Text type="secondary">{t("基础版基础能力与 PRO 增强、适用品类、当前可用数量与上线状态；不用模糊勾选掩盖未交付。")}</Typography.Text>
              <Button type="link" style={{ paddingInline: 0 }} onClick={() => navigate(APP_ROUTES.subscriptionPro.path)}>{t("查看 PRO 介绍与完整对比")}<RightOutlined /></Button>
            </Space>
          </SectionCard>

          <SectionCard title="当前功能权益">
            <Descriptions column={1} size="small" colon={false}
              items={[
                { key: "basic", label: t("基础版公共包含"), children: t(PLACEHOLDER) },
                { key: "extra", label: t("本租户额外授权"), children: t(PLACEHOLDER) },
                { key: "pro", label: t("PRO 权益"), children: t(PLACEHOLDER) },
                { key: "upgrade", label: t("仍需升级"), children: t(PLACEHOLDER) }
              ]}
            />
          </SectionCard>

          <SectionCard title="标准套餐价与续费说明">
            <Typography.Text type="secondary">{t("基础版 / PRO 标准年费、币种与税口径：价格待公布；升级补差与外部费用另计，不代表已开通自动扣费。")}</Typography.Text>
          </SectionCard>

          <SectionCard title="申请与办理记录">
            <Empty description={t("暂无申请记录")} />
          </SectionCard>

          <SectionCard title="订阅变更记录">
            <Empty description={t("暂无变更记录")} />
          </SectionCard>

          <SectionCard title="待生效变更与退出说明">
            <Typography.Text type="secondary">{t("下一套餐 / 生效时间、到期不续费登记、历史查询与数据保留说明；未配置的商业期限显示待平台确认。")}</Typography.Text>
          </SectionCard>

          <SectionCard title="帮助与费用说明">
            <Typography.Text type="secondary">{t("平台联系渠道、外部按量 / 硬件费用、退款 / 降级边界、数据与在途业务保留说明。")}</Typography.Text>
          </SectionCard>
        </Space>
      }
    />
  );
}
