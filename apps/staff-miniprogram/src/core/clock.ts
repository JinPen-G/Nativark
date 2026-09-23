/**
 * 服务端时钟校准。倒计时（报价有效期、付款截止）一律用 serverNow() 而不是设备时间，
 * 设备时间可能被手动改过。校准来源是响应头 Date（每次请求都会更新）。
 */
let skewMs = 0;
let calibrated = false;

export function noteServerDate(header: unknown): void {
  const raw = typeof header === "string" ? header : undefined;
  if (!raw) return;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return;
  skewMs = parsed - Date.now();
  calibrated = true;
}

export function serverNow(): number {
  return Date.now() + skewMs;
}

export function clockCalibrated(): boolean {
  return calibrated;
}

/** 距离某个服务端截止时间还剩多少毫秒；已过期返回负数；无截止时间返回 undefined。 */
export function remainingMs(deadlineIso: string | undefined): number | undefined {
  if (!deadlineIso) return undefined;
  const deadline = Date.parse(deadlineIso);
  if (!Number.isFinite(deadline)) return undefined;
  return deadline - serverNow();
}

export function formatRemaining(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms <= 0) return "已到期";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours} 小时 ${minutes % 60} 分`;
  }
  return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
}

/** 仅供测试重置。 */
export function resetClockForTest(): void {
  skewMs = 0;
  calibrated = false;
}
