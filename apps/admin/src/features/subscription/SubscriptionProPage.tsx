import { RightOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import { Alert, Button, Card, Space, Tag, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { APP_ROUTES } from "@/app/navigation";

/**
 * SUB-02 PRO 介绍与版本对比页（需求 §6），路由 /settings/subscription/pro。
 *
 * 静态骨架：把「当前可购买」与「规划中 / 受控试点」分区展示，用业务示例说明，
 * 不展示 capability code / 内部版本号 / 0 元 / 虚构折扣 / 自动试用（§6.2-§6.4、§6.8）。
 * 真实功能目录与标准价接总控 SUB-01 契约（TODO）。
 */
function Block({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useLocale();
  return <Card size="small" title={t(title)}>{children}</Card>;
}

export function SubscriptionProPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const canManage = useAuthStore((state) => state.hasPermission("rental-os:subscription:manage"));

  return (
    <PageHeader
      title="PRO 介绍与版本对比"
      description="了解 PRO 适合的经营场景、与基础版的差异和各品类专业模块；申请升级与版本页共用同一办理流程。"
      view={
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message={t("四品类首批专业包全部验收通过后 PRO 才正式销售；未满足销售条件的项目标为「升级咨询」，不代表立即可用、不会自动收款或开通。")}
          />

          <Block title="PRO 能解决什么">
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {t("适合哪些商户、可解决的经营问题、与基础版的核心差异——用高价值器材交接、多驾驶人、施工日报等业务示例说明，不以内部实现名词作卖点。")}
            </Typography.Paragraph>
          </Block>

          <Block title="当前可购买（已上线）">
            <Typography.Text type="secondary">{t("仅列已实际验收、可申请启用的功能；此处不计入规划项。")}</Typography.Text>
          </Block>

          <Block title="规划中 / 受控试点">
            <Space wrap>
              <Tag>{t("规划中")}</Tag>
              <Tag color="processing">{t("受控试点")}</Tag>
            </Space>
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              {t("规划与试点项单独展示，不计入本次办理承诺交付；试点需申请且有适用范围与未验证边界。")}
            </Typography.Paragraph>
          </Block>

          <Block title="品类专业模块">
            <Typography.Text type="secondary">{t("可查看全部品类介绍，也可筛选自己经营的品类；未经营品类标明需要相应空间与运营准备，不承诺升级即自动开出该品类。")}</Typography.Text>
          </Block>

          <Block title="费用与启用条件">
            <Typography.Text type="secondary">{t("价格待公布 / 联系平台；含税与外部费用边界另计，不展示 0 元、原价或折扣。")}</Typography.Text>
          </Block>

          <Block title="常见问题">
            <Typography.Text type="secondary">{t("升级不影响既有报价、订单与空间配置；到期与降级后专业配置保留，重新授权时重新核验依赖。")}</Typography.Text>
          </Block>

          <Space wrap>
            <Button onClick={() => navigate(APP_ROUTES.subscription.path)}>{t("返回版本与订阅")}</Button>
            {/* 与版本页共用同一办理流程（§6.6）；未满足销售条件时按「升级咨询」。写动作用 :manage 门禁。 */}
            <Button type="primary" disabled={!canManage}>{t("申请升级 / 联系平台")}<RightOutlined /></Button>
          </Space>
        </Space>
      }
    />
  );
}
