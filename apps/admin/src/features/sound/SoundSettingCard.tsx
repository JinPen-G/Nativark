import { App, Button, Card, Select, Slider, Space, Switch, Typography } from "antd";
import { SoundOutlined } from "@ant-design/icons";
import { useSyncExternalStore } from "react";
import { useLocale } from "@/app/locale";
import { INTERACTION_SOUNDS, NOTIFICATION_SOUNDS, SOUND_LABELS, SOUND_PACKS, type SoundName } from "./soundPacks";
import { soundPreferences } from "./soundPreferences";
import { previewSound } from "./soundService";

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
    <Space wrap>{names.map(name => <Button key={name} size="small" data-sound-preview={name} onClick={() => void preview(name)}>{t(SOUND_LABELS[name])}</Button>)}</Space>
  );

  return (
    <Card size="small" title={<Space><SoundOutlined />{t("界面音效")}</Space>} data-sound-silent>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Space wrap>
          <Typography.Text>{t("音效方案")}</Typography.Text>
          <Select aria-label={t("音效方案")} value={preferences.pack} style={{ minWidth: 160 }}
            options={SOUND_PACKS.map(pack => ({ value: pack.id, label: t(pack.label) }))}
            onChange={pack => soundPreferences.update({ pack })} />
        </Space>
        <Space wrap>
          <Switch aria-label={t("交互音效")} checked={preferences.interactionEnabled} onChange={interactionEnabled => soundPreferences.update({ interactionEnabled })} />
          <Typography.Text>{t("交互音效")}</Typography.Text>
          <Typography.Text type="secondary">{t("按钮、勾选、开关与页面跳转的轻微反馈。")}</Typography.Text>
        </Space>
        <Space wrap>
          <Switch aria-label={t("通知与结果音")} checked={preferences.notificationEnabled} onChange={notificationEnabled => soundPreferences.update({ notificationEnabled })} />
          <Typography.Text>{t("通知与结果音")}</Typography.Text>
          <Typography.Text type="secondary">{t("仅在已接入的真实操作结果或通知事件到达时播放。")}</Typography.Text>
        </Space>
        <div style={{ width: "100%", maxWidth: 360 }}>
          <Typography.Text>{t("音量")}：{Math.round(preferences.volume * 100)}%</Typography.Text>
          <Slider aria-label={t("音量")} min={0} max={100} value={Math.round(preferences.volume * 100)}
            onChange={value => soundPreferences.update({ volume: value / 100 })} />
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
