export const INTERACTION_SOUNDS = ["press", "tick", "release", "page", "pulse"] as const;
export const NOTIFICATION_SOUNDS = ["notification", "success", "error", "attention"] as const;
export type InteractionSound = typeof INTERACTION_SOUNDS[number];
export type NotificationSound = typeof NOTIFICATION_SOUNDS[number];
export type SoundName = InteractionSound | NotificationSound;

export interface SoundLayer {
  source: { type: "sine" | "square" | "triangle" | "sawtooth"; frequency: number | { start: number; end: number } } | { type: "noise" };
  filter?: { type: "lowpass" | "highpass" | "bandpass"; frequency: number; resonance?: number };
  envelope: { attack: number; decay: number; release?: number };
  gain: number;
  delay?: number;
}
export type SoundVoice = SoundLayer | { layers: readonly SoundLayer[] };
export interface SoundPack {
  id: string;
  label: string;
  sounds: Record<SoundName, SoundVoice>;
}

export const SOUND_LABELS: Record<SoundName, string> = {
  press: "按钮", tick: "勾选 / 开关", release: "关闭 / 删除", page: "链接跳转", pulse: "保存 / 提交",
  notification: "新通知", success: "操作成功", error: "操作失败", attention: "需要关注"
};
export const DEFAULT_SOUND_PACK = "sound-1";

// 前五种保留 beautifului.dev 点击预设；后四种为同风格新设计，不是原站提取音。
const soundOne: SoundPack = {
  id: DEFAULT_SOUND_PACK,
  label: "音效一",
  sounds: {
    press: { layers: [
      { source: { type: "noise" }, filter: { type: "highpass", frequency: 2400 }, envelope: { attack: 0.0003, decay: 0.009 }, gain: 0.13 },
      { source: { type: "sine", frequency: 680 }, envelope: { attack: 0.0006, decay: 0.022, release: 0.008 }, gain: 0.24 }
    ] },
    tick: { source: { type: "square", frequency: 2100 }, filter: { type: "bandpass", frequency: 2600, resonance: 1.6 }, envelope: { attack: 0.0004, decay: 0.028 }, gain: 0.24 },
    release: { source: { type: "noise" }, filter: { type: "lowpass", frequency: 1600, resonance: 0.9 }, envelope: { attack: 0.001, decay: 0.055 }, gain: 0.32 },
    page: { source: { type: "sine", frequency: { start: 430, end: 640 } }, envelope: { attack: 0.002, decay: 0.11, release: 0.03 }, gain: 0.4 },
    pulse: { source: { type: "sine", frequency: 330 }, filter: { type: "lowpass", frequency: 2200 }, envelope: { attack: 0.002, decay: 0.13, release: 0.04 }, gain: 0.5 },
    notification: { layers: [
      { source: { type: "sine", frequency: 660 }, envelope: { attack: 0.004, decay: 0.14, release: 0.035 }, gain: 0.42 },
      { source: { type: "sine", frequency: 880 }, envelope: { attack: 0.005, decay: 0.22, release: 0.065 }, delay: 0.14, gain: 0.32 }
    ] },
    success: { layers: [
      { source: { type: "sine", frequency: 523.25 }, envelope: { attack: 0.003, decay: 0.09, release: 0.025 }, gain: 0.32 },
      { source: { type: "sine", frequency: 659.25 }, envelope: { attack: 0.003, decay: 0.09, release: 0.025 }, delay: 0.075, gain: 0.30 },
      { source: { type: "sine", frequency: 783.99 }, envelope: { attack: 0.004, decay: 0.22, release: 0.05 }, delay: 0.15, gain: 0.32 }
    ] },
    error: { layers: [
      { source: { type: "sine", frequency: 392 }, envelope: { attack: 0.004, decay: 0.11, release: 0.03 }, gain: 0.42 },
      { source: { type: "sine", frequency: 261.63 }, envelope: { attack: 0.005, decay: 0.20, release: 0.045 }, delay: 0.13, gain: 0.40 }
    ] },
    attention: { layers: [
      { source: { type: "sine", frequency: 740 }, envelope: { attack: 0.006, decay: 0.12, release: 0.03 }, gain: 0.38 },
      { source: { type: "sine", frequency: 740 }, envelope: { attack: 0.006, decay: 0.16, release: 0.04 }, delay: 0.22, gain: 0.38 }
    ] }
  }
};

/** 新增音效二/三时，在此注册完整方案；触发代码不按方案分支。 */
export const SOUND_PACKS: readonly SoundPack[] = [soundOne];
export function resolveSoundPack(id: string, packs: readonly SoundPack[] = SOUND_PACKS): SoundPack {
  return packs.find(pack => pack.id === id) ?? soundOne;
}
