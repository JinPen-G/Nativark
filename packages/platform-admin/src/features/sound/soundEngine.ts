import type { SoundLayer, SoundVoice } from "./soundPacks";

/** 只负责合成，不读取业务状态或偏好。没有用户手势时不创建/恢复音频设备。 */
let context: AudioContext | null = null;
let master: GainNode | null = null;
let unlocking: Promise<boolean> | null = null;
const noiseCache = new Map<number, AudioBuffer>();

export function isAudioReady(): boolean {
  return context?.state === "running" && master !== null;
}

export async function unlockAudio(): Promise<boolean> {
  try {
    if (typeof window === "undefined") return false;
    if (!context || context.state === "closed") {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return false;
      context = new AC();
      master = context.createGain();
      master.gain.value = 0.32;
      master.connect(context.destination);
      noiseCache.clear();
    }
    if (context.state === "running") return true;
    if (!unlocking) {
      unlocking = context.resume().then(() => isAudioReady(), () => false).finally(() => { unlocking = null; });
    }
    return await unlocking;
  } catch {
    unlocking = null;
    return false;
  }
}

export function setMasterGain(value: number): void {
  if (master && Number.isFinite(value)) master.gain.value = Math.min(1, Math.max(0, value));
}

function noise(audio: AudioContext): AudioBuffer {
  const cached = noiseCache.get(audio.sampleRate);
  if (cached) return cached;
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.3), audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  noiseCache.set(audio.sampleRate, buffer);
  return buffer;
}

function playLayer(audio: AudioContext, output: GainNode, layer: SoundLayer, start: number): () => void {
  const envelope = audio.createGain();
  let source: OscillatorNode | AudioBufferSourceNode | undefined;
  let filter: BiquadFilterNode | undefined;
  const disconnect = () => {
    source?.disconnect();
    filter?.disconnect();
    envelope.disconnect();
  };
  try {
    const { attack, decay, release = 0 } = layer.envelope;
    const duration = attack + decay + release;
    // 与已试听预设一致：线性起音后指数衰减到近零，没有持续段。
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(layer.gain, start + attack);
    envelope.gain.setTargetAtTime(0.0001, start + attack, Math.max(decay / 3, 0.0001));
    if (layer.source.type === "noise") {
      const node = audio.createBufferSource();
      source = node;
      node.buffer = noise(audio);
      node.loop = true;
    } else {
      const node = audio.createOscillator();
      source = node;
      node.type = layer.source.type;
      const frequency = layer.source.frequency;
      if (typeof frequency === "number") node.frequency.setValueAtTime(frequency, start);
      else {
        node.frequency.setValueAtTime(frequency.start, start);
        node.frequency.exponentialRampToValueAtTime(Math.max(frequency.end, 1), start + duration);
      }
    }
    if (layer.filter) {
      filter = audio.createBiquadFilter();
      filter.type = layer.filter.type;
      filter.frequency.value = layer.filter.frequency;
      if (layer.filter.resonance != null) filter.Q.value = layer.filter.resonance;
      source.connect(filter);
      filter.connect(envelope);
    } else source.connect(envelope);
    envelope.connect(output);
    source.onended = disconnect;
    source.start(start);
    source.stop(start + duration + 0.1);
    return () => { try { source?.stop(); } catch { /* 已结束 */ } disconnect(); };
  } catch (error) {
    try { source?.stop(); } catch { /* 尚未启动 */ }
    disconnect();
    throw error;
  }
}

/** 自动事件只能播放已解锁设备；失败不向业务调用者抛异常。 */
export function playVoice(voice: SoundVoice, volume: number): boolean {
  if (!isAudioReady() || !context || !master || !Number.isFinite(volume) || volume <= 0) return false;
  const cleanup: Array<() => void> = [];
  try {
    setMasterGain(volume);
    const start = context.currentTime;
    const layers = "layers" in voice ? voice.layers : [voice];
    for (const layer of layers) cleanup.push(playLayer(context, master, layer, start + (layer.delay ?? 0)));
    return true;
  } catch {
    cleanup.forEach(dispose => dispose());
    return false;
  }
}
