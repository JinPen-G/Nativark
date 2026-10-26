import { useSyncExternalStore } from "react";
import { Card, Typography } from "antd";
import { Segmented } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { getMotionPreference, setMotionPreference, subscribeMotionPreference, type MotionPreference } from "@/app/motionPreferences";

export function MotionSettingCard() {
  const { t } = useLocale();
  const preference = useSyncExternalStore(subscribeMotionPreference, getMotionPreference, () => "system" as const);
  return <Card size="small" title={t("界面动效")}>
    <Segmented<MotionPreference> aria-label={t("动效偏好")} value={preference} onChange={setMotionPreference}
      options={[{ value: "system", label: t("跟随系统") }, { value: "full", label: t("完整动效") }, { value: "reduced", label: t("减少动效") }]} />
    <Typography.Paragraph className="text-meta" type="secondary" style={{ marginTop: "var(--space-2)", marginBottom: 0 }}>
      {t("仅保存在当前浏览器，立即生效。")}
    </Typography.Paragraph>
  </Card>;
}
