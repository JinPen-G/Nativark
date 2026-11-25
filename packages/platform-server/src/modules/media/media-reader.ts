/** 消费已授权的字节流并检查原 PNG/JPEG/PCM 格式、大小、尺寸与摘要。
 * 取消只终止本次读取，不证明上游操作已回滚；业务引用、文件冻结与错误映射由调用者负责。 */
import { createHash } from "node:crypto";
import type { ReadableStreamReadResult } from "node:stream/web";
import { inspectBoundedImage } from "./bounded-image";
import { inspectPcmWav } from "./pcm-wav";

export type BoundedMediaReadErrorCode = "INVALID_INPUT" | "CAPABILITY_UNSUPPORTED" | "RECONCILIATION_REQUIRED";

export class BoundedMediaReadError extends Error {
  constructor(readonly code: BoundedMediaReadErrorCode) {
    super(code);
  }
}

/** 原业务可提供自己的错误类型，解析、取消和释放仍执行同一实现。 */
export function createBoundedMediaReader(error: (code: BoundedMediaReadErrorCode) => Error = code => new BoundedMediaReadError(code)) {
  function inspectMedia(bytes: Buffer): { mediaType: string; width: number | null; height: number | null; durationMs: number | null } {
    const image = inspectBoundedImage(bytes);
    if (image) return { ...image, durationMs: null };
    if (bytes.length >= 2 && (bytes[0] === 137 && bytes[1] === 80 || bytes[0] === 255 && bytes[1] === 216)) {
      throw error("INVALID_INPUT");
    }
    if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") {
      const audio = inspectPcmWav(bytes);
      if (!audio) throw error("INVALID_INPUT");
      return { mediaType: "audio/wav", width: null, height: null, durationMs: audio.durationMs };
    }
    throw error("CAPABILITY_UNSUPPORTED");
  }

  return async function readMedia(stream: ReadableStream<Uint8Array>, maxBytes: number, signal: AbortSignal) {
    const reader = stream.getReader(), chunks: Buffer[] = [];
    let sizeBytes = 0;
    let cancelled = false;
    let rejectRead: ((reason: Error) => void) | undefined;
    const cancel = () => {
      rejectRead?.(error("RECONCILIATION_REQUIRED"));
      if (cancelled) return;
      cancelled = true;
      // 上游清理不能阻止本次读取释放；只尝试一次取消并观察拒绝。
      try { void reader.cancel().catch(() => undefined); } catch { /* best effort */ }
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 20 * 1024 * 1024) throw error("INVALID_INPUT");
      for (;;) {
        if (signal.aborted) throw error("RECONCILIATION_REQUIRED");
        const next = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
          rejectRead = reject;
          reader.read().then(resolve, reject);
          if (signal.aborted) cancel();
        });
        rejectRead = undefined;
        if (signal.aborted) throw error("RECONCILIATION_REQUIRED");
        if (next.done) break;
        if (!(next.value instanceof Uint8Array)) throw error("INVALID_INPUT");
        sizeBytes += next.value.byteLength;
        if (sizeBytes > maxBytes) throw error("INVALID_INPUT");
        chunks.push(Buffer.from(next.value));
      }
      const bytes = Buffer.concat(chunks), metadata = inspectMedia(bytes);
      return { bytes, sizeBytes, contentHash: createHash("sha256").update(bytes).digest("hex"), ...metadata };
    } finally {
      signal.removeEventListener("abort", cancel);
      rejectRead = undefined;
      cancel();
      reader.releaseLock();
    }
  };
}

export const readBoundedMedia = createBoundedMediaReader();
