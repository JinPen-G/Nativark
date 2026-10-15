# LB34 第一批知识/记忆完整生命周期消费

起点：edc5620e；交付提交：本记录所在提交。分支为 ai/codex-ai-native-lane-b-20261007，工作区初始干净，无MERGE_HEAD。未修改公共Auth/Guard、shared、schema/migration、runner、Gateway、Core或其他工作树。

## 新增实际入口

- `HumanKnowledgeService.prepareCreate(draft)`：严格既有文档元数据/附件引用，当前 `create` 动作授权、文件端口存在检查，返回范围/owner/实际Parser支持格式和下一步。附件归属仍由正式KnowledgeAuthorization生产者核验；不接受URL、不读取正文、不创建文档。
- `parseReadiness(documentId)`：读取当前持久head，分别复核parse/read_body动作、文件端口、draft/状态/待定操作；`ready`仅能发起解析，不表示解析完成。pending返回reconcile，不重发。
- `preview(documentId, limit)`：当前人类read_body授权下，从持久解析chunk提供最多10个可定位片段、版本/ACL、内容指纹和untrusted_data；draft parsed也可预览，未发布不等于可检索/批准，撤回/删除不可用。
- `operationStatus(documentId, operationId)`：复用原receipt/head，分开展示publication/parsing/indexing/indexJob；receipt不等于发布完成或索引可用。
- `PersistentMemoryConsentService.selectPreferences({kinds,limit})`：kind必须显式且非空，过滤当前正式confirmedPreferences；不选择其他主体/空间，不覆盖Core、金额、权限或审批。

## 复用而未重写的B项

B2创建/读回、B5发布门槛、B6原操作核对、B7不可变revise、B8withdraw/delete和即时来源拒绝、B9detail逐动作能力、B10Memory门面、B12显式组合均复用LB27-LB33已有入口。此次新增预览的读取链复用真实PrismaKnowledgeReadAdapter和当前授权；没有新状态机、影子文档或下载URL。

## 验证

固定 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`，双离线preload，AI_OFFLINE_AUDIT为本树绝对 `output/b1-b11-audit`。`node --test tests/ai-native-knowledge-lane-b-preparation.test.cjs`：2 pass、0 fail、0 skip、0 todo，退出0。覆盖创建准备、无权限拒绝、解析前检查、解析后draft正文预览、版本修订保留旧版本、receipt状态分离，以及两类已确认偏好按显式kind选择。首次预览实现错误地复用了仅published的chunk查询，红测暴露后改为独立的parsed-preview查询；没有放宽发布/检索路径。

`git diff --check`在提交前通过。API隔离noEmit将在本批最终集中执行。测试数据库/文件/Auth policy为受控替身，不称真实MySQL、文件存储或生产授权。

## 剩余缺口

正式Knowledge/Memory动作政策、文件业务归属及有界bytes生产者仍需主线提供；历史版本完整受权列表、可靠分页、同Memory ID期限续期契约、失败索引/未知解析重试策略、分布式缓存传播均未私造。真实HTTP/DB/模型/设备未验，局部功能不代表AIN-10/24或原28项完成。
