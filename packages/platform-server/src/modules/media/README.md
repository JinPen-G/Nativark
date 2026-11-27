# 有界媒体读取

Core 已完成业务授权并取得受控字节流后，从 `@rental-os/platform-server/media` 调用 `readBoundedMedia(stream, maxBytes, signal)`。它共用原 PNG/JPEG 和 PCM WAV 检查、20 MiB 上限、尺寸及帧计时算法，返回原字节、实际大小、SHA-256 和媒体元数据。[读取实现](media-reader.ts) · [图片](bounded-image.ts) · [音频](pcm-wav.ts)

```ts
import { readBoundedMedia } from "@rental-os/platform-server/media";

// stream 由所属 Core 的授权与原文件读取入口取得。
const media = await readBoundedMedia(stream, registeredSize, signal);
```

解析不访问模型、数据库、URL 或对象存储，不证明附件归属、像素可解码或模型支持该媒体。业务层继续核对当前权限、原文件绑定、登记类型及冻结摘要。格式不合法、超限和不支持的媒体明确拒绝；取消只停止这次读取，清理不等待上游无限挂起，也不证明原操作已回滚。

旧业务需要保留错误类型时，用 `createBoundedMediaReader(code => new OriginalError(code))` 装配同一读取实现。原检查入口保留 `InspectionAssistError` 和 `INSPECTION_OBJECT_READER` 的身份，普通 Core 无须加载检查服务或 AI 表。[原兼容入口](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/modules/ai-native/inspection-assist/inspection-media.reader.ts) · [Rental 文件参加者](../../../../rental-core/src/file-application-rental-evidence.ts)

原有界读取冒烟位于 [检查媒体用例](../../../../../tests/ai-native-inspection-media-submission.test.cjs)，验证前核对范围及离线约束；它的其他场景还需要真实业务参加者。[公共服务导读](../../../README.md)
