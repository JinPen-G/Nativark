# AIN-10 Lane B 14：来源内容读取上下文隔离

前置 `35bc84ad`。本片补齐 `KnowledgeSourceService.readChunk` 的异步输入边界：内容端口属于受控服务端适配，但如果它修改调用方 context，旧实现会让后续 head/授权读回使用被改写的 workspace。

## 实现

- 读取入口建立调用方 context 指纹和稳定副本；加载文档、授权、内容读取、二次读回和缓存失效均使用稳定 scope。
- 内容端口只收到稳定 context 与 source 的结构化副本；其修改不会污染调用方、待比较的 source 或缓存键。
- 每个 await 后复核调用方和稳定副本；调用上下文变化 fail closed，撤权错误路径只清理稳定 scope 下当前文档的缓存。

## 红测与验证

- 红测 `node --test tests/ai-native-knowledge-lane-b-source-context.test.cjs`：pass0/fail1/skip0/todo0，退出1；受控 content port 修改 context 后旧实现读回 unavailable。
- 中间一次修复后命令因 preload 路径误写为重复的 `...worktrees/rental-OS/...` 失败，退出1，未执行业务测试；未修改代码后使用本树正确绝对路径重跑。
- 修复后同一测试：pass1/fail0/skip0/todo0，退出0；实际来源服务、文档服务、内容端口和内存仓储参与，返回原文档 chunk，调用 context 仍为 `space-1`。
- 来源/缓存/检索/持久内容回归：8 个测试文件，共 71 pass、0 fail、0 skip、0 todo，退出0；知识隔离 TypeScript zero diagnostics，退出0。
- `git diff --check`：退出0。

## 证据等级与未验项

- 证据：离线实际服务和内容端口行为、内存仓储、严格知识 TypeScript；固定无效 DATABASE_URL、本树 preload/audit，网络拦截无尝试。
- 未验：真实文件存储/下载、MySQL/分布式缓存/索引广播、HTTP、模型、支付、浏览器/微信/真机和生产部署。
- 正式来源生命周期接线仍需主线按现有模块装配，缺授权/文件/内容端口继续 unavailable。作者完成待独立复核，不宣称 AIN-10/24 或整体专项完成。
