import type { MutationCache } from "@tanstack/react-query";
import { captureSoundScope, emitSoundEvent, type SoundEvent, type SoundScope } from "./soundService";

type CacheConfig = NonNullable<ConstructorParameters<typeof MutationCache>[0]>;

/** 明确 opt-in 的写操作才配结果音，查询/取消/旧会话结果不配音。 */
export function createMutationSoundCallbacks(
  getEpoch: () => number,
  getScope: () => SoundScope | null = captureSoundScope,
  emit: (event: SoundEvent) => Promise<boolean> = emitSoundEvent
): CacheConfig {
  const attempts = new WeakMap<object, { id: string; scope: SoundScope; epoch: number }>();
  const prefix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  let sequence = 0;
  function finish(mutation: object, type: "success" | "error") {
    const attempt = attempts.get(mutation);
    if (!attempt) return;
    attempts.delete(mutation);
    if (getEpoch() !== attempt.epoch || getScope()?.key !== attempt.scope.key) return;
    // 音频不是业务事务的一部分；它失败也不能让真实保存被报成失败。
    try { void emit({ ...attempt.scope, epoch: attempt.epoch, id: attempt.id, type }).catch(() => {}); } catch { /* 音效不可用 */ }
  }
  return {
    onMutate: (_variables, mutation) => {
      const scope = getScope();
      if (mutation.options.meta?.soundFeedback === true && scope) {
        attempts.set(mutation, { id: `${prefix}:${++sequence}`, scope, epoch: getEpoch() });
      }
    },
    onSuccess: (data, _variables, _context, mutation) => {
      finish(mutation, data && typeof data === "object" && "ok" in data && data.ok === false ? "error" : "success");
    },
    onError: (error, _variables, _context, mutation) => {
      if (error && typeof error === "object" && (("code" in error && error.code === "ERR_CANCELED") || ("name" in error && (error.name === "AbortError" || error.name === "CanceledError")))) {
        attempts.delete(mutation);
        return;
      }
      finish(mutation, "error");
    },
    onSettled: (_data, _error, _variables, _context, mutation) => { attempts.delete(mutation); }
  };
}
