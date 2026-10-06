# Lane B 08：附件运行时类型与大小边界

前置 `941fe6d5`。知识解析前的 `KnowledgeFilePort` 虽声明 Uint8Array，运行时原实现直接访问 `byteLength`，畸形文件适配器会变成泛化 `parse_failed`，而非结构化的边界拒绝。

修复 `KnowledgeDocumentService.parseDocument`：在任何 parser 调用前验证 file/mediaType/Uint8Array；非法 bytes 记录 `invalid_text`，合法但超过 262144 bytes 记录 `limit_exceeded`，且 parser 不被调用、chunks 不持久化。未改变读取端口的授权或上限参数。

验证（固定无效 DATABASE_URL、本树 audit、两个离线 preload）：

- 红测：首次 malformed bytes 场景 pass1/fail1、退出1，确认缺陷；随后调整 oversized 夹具为合法 Uint8Array 以区分类型/大小语义。
- 绿测 `node --test tests/ai-native-knowledge-lane-b-file-boundary.test.cjs tests/ai-native-knowledge-parser.test.cjs tests/ai-native-knowledge-lifecycle.test.cjs`：18/18 pass，fail0/skip0/todo0，退出0。
- 包含实际 KnowledgeDocumentService、KnowledgeTextParser 和持久化替身；无网络调用。知识严格 TS noEmit 在生命周期回归中通过，未宣称全 API build。
- `git diff --check`：提交前运行。

未验真实文件存储/扫描器、MySQL、真实 HTTP/模型/生产 ACL。待主线独立复核，不宣称 AIN-10/24 完成。
