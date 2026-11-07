import { Card, Space, Typography } from "antd";
import { App } from "@/components/ui";
import { Slider } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Button } from "@/components/ui";
import { Select } from "@/components/ui";
import { SoundOutlined } from "@/components/ui/icons";
import { useSyncExternalStore } from "react";
import { useLocale } from "@/app/locale";
import { INTERACTION_SOUNDS, NOTIFICATION_SOUNDS, SOUND_LABELS, SOUND_PACKS, type SoundName } from "./soundPacks";
import { soundPreferences } from "./soundPreferences";
import { previewSound } from "./soundService";
import { Play } from "lucide-react";
import styles from "@/features/appearance/PreferencePreview.module.css";

/** 浏览器本地设置，与品牌/圆角后端表单独立；整卡静音自动点击，试听不叠音。 */
export function SoundSettingCard() {
  const { t } = useLocale();
  const { message } = App.useApp();
  const preferences = useSyncExternalStore(soundPreferences.subscribe, soundPreferences.getSnapshot);
  const preview = async (name: SoundName) => {
    if (preferences.volume === 0) { message.info(t("当前音量为 0，请先调高音量再试听。")); return; }
    if (!await previewSound(name)) message.warning(t("无法播放音效，请检查浏览器音频权限与输出设备后重试。"));
  };
  const samples = (names: readonly SoundName[]) => (
    <div className={styles.samples}>{names.map(name => <Button key={name} size="small" icon={<Play size={15}/>} data-sound-preview={name} onClick={() => void preview(name)}>{t(SOUND_LABELS[name])}</Button>)}</div>
  );

  return (
    <Card size="small" title={<Space><SoundOutlined />{t("界面音效")}</Space>} data-sound-silent>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Space wrap>
          <Typography.Text>{t("音效方案")}</Typography.Text>
          <Select aria-label={t("音效方案")} value={preferences.pack} style={{ minWidth: "min(100%, var(--rental-control-width-select))" }}
            options={SOUND_PACKS.map(pack => ({ value: pack.id, label: t(pack.label) }))}
            onChange={pack => soundPreferences.update({ pack })} />
        </Space>
        <div className={styles.soundRows}><div>
          <div><strong>{t("交互音效")}</strong><p>{t("按钮、勾选、开关与页面跳转的轻微反馈。")}</p></div>
          <Switch aria-label={t("交互音效")} checked={preferences.interactionEnabled} onChange={interactionEnabled => soundPreferences.update({ interactionEnabled })} />
        </div><div>
          <div><strong>{t("通知与结果音")}</strong><p>{t("仅在已接入的真实操作结果或通知事件到达时播放。")}</p></div>
          <Switch aria-label={t("通知与结果音")} checked={preferences.notificationEnabled} onChange={notificationEnabled => soundPreferences.update({ notificationEnabled })} />
        </div></div>
        <div style={{ width: "100%", maxWidth: 360 }}>
          <Slider label={t("音量")} min={0} max={100} value={Math.round(preferences.volume * 100)} format={value => `${value}%`}
            onValueChange={value => soundPreferences.update({ volume: value / 100 })} />
        </div>
        <Space orientation="vertical" size={8}>
          <Typography.Text>{t("交互音试听")}</Typography.Text>
          {samples(INTERACTION_SOUNDS)}
          <Typography.Text>{t("通知音试听")}</Typography.Text>
          {samples(NOTIFICATION_SOUNDS)}
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t("设置仅保存在当前浏览器，无需点击保存。试听不改变开关；音量为 0 时静音。")}
          <br />
          {t("当前已接入圆角和客户端配置的保存结果；通知中心尚未接入，新通知与关注音暂供试听和事件接口调用。")}
        </Typography.Paragraph>
      </Space>
    </Card>
  );
}
