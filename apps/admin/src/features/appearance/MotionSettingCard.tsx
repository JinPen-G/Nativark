import { useState, useSyncExternalStore } from "react";
import { Card, Typography } from "antd";
import { Button, Segmented } from "@/components/ui";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import styles from "./PreferencePreview.module.css";
import { useLocale } from "@/app/locale";
import { getMotionPreference, setMotionPreference, subscribeMotionPreference, type MotionPreference } from "@/app/motionPreferences";

export function MotionSettingCard() {
  const { t } = useLocale();
  const preference = useSyncExternalStore(subscribeMotionPreference, getMotionPreference, () => "system" as const);
  const reduced = usePrefersReducedMotion();
  const [preview, setPreview] = useState(false);
  return <Card size="small" title={t("界面动效")}>
    <Segmented<MotionPreference> aria-label={t("动效偏好")} value={preference} onChange={setMotionPreference}
      options={[{ value: "system", label: t("跟随系统") }, { value: "full", label: t("完整动效") }, { value: "reduced", label: t("减少动效") }]} />
    <Typography.Paragraph className="text-meta" type="secondary" style={{ marginTop: "var(--space-2)", marginBottom: 0 }}>
      {t("仅保存在当前浏览器，立即生效。")}
    </Typography.Paragraph>
    <div className={styles.motionDemo}>
      <p>{t("预览当前动效偏好")}</p>
      <Button onClick={()=>setPreview(value=>!value)}>{t(preview?"收起预览":"播放预览")}</Button>
      <AnimatePresence initial={false}>{preview&&<motion.div className={styles.sampleRow} initial={reduced?false:{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduced?0:4}} transition={{duration:reduced?0:.2}}><Check size={16}/>{t("界面反馈预览")}</motion.div>}</AnimatePresence>
    </div>
  </Card>;
}
