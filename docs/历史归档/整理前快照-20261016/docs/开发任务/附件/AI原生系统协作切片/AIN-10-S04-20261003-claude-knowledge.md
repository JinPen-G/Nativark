# AIN-10/S04 受限文本解析与结构化偏好记忆

2026-10-03，负责人明确让Codex接手“知识与记忆长任务 (fork)”。保留Claude已提交S01 e46f9ff、S02 6d6a5d7、S03 bf7195f及全部未提交S04六文件；在原知识线专用树/分支接续，未使用主Claude或网关树。基线bf7195f8cae346b149fcb9dbcdc90ccc46f53e8b。

只读定位该标题最近ffaad4b3会话及主专项背景：S04曾声称64项通过但未提交，最后是接口400“different Azure OpenAI resource”而非业务测试错误。本轮不采信口述验收，重新阅读实际实现与测试并运行确认。没有控制Claude窗口、发送跨会话消息或读凭据。

## 实现与自查

正文只解析UTF-8纯文本/Markdown；PDF/Office/图片/HTML MIME明确unsupported。字节262144、字符200000、块数200、片段2000限制；非法UTF-8/NUL/空白拒绝。CRLF归一化、稳定section/paragraph/chunk定位，长段落不劈开UTF16代理对。HTML/JS/链接/include/提示注入保留字面untrusted_data，不执行、不下载。

结构化记忆只支持locale/display_density/fulfillment_location；当前owner/scope授权、revision CAS、幂等收据、90日有界过期、proposed/confirmed/deleted。确认读取必需服务端记录，核对actor/scope/audience/content/revision/ACL/期限，commit端口要求仍校验未撤销；ID不是批准。modify使旧确认失效；删除tombstone不含偏好/确认，不删除业务事实。地点偏好不授予地点权限。

ports与fixture增量及解析器/记忆服务/两测试均原Claude在途成果；Codex本轮只增加此记录，完成接手自复查和必要回归后提交，不能把这次称非作者独立Review。仓储授权/确认记录来自合成替身，真实确认及DB提交原子性仍待主协调者接线。

## 实测

在本树执行 `node --test tests/ai-native-knowledge-lifecycle.test.cjs tests/ai-native-knowledge-access.test.cjs tests/ai-native-knowledge-cache.test.cjs tests/ai-native-knowledge-parser.test.cjs tests/ai-native-memory-service.test.cjs tests/ai-native-knowledge-contracts.test.cjs`：64/64，退出0，无skip/todo。包含实际knowledge全部模块noEmit零诊断、C06契约及服务组合；ts-node非transpileOnly。fixture项目导入前拦截socket/TLS/UDP/fetch/DNS，连接尝试0。

未运行真实DB/HTTP Guard/附件供应商/模型/浏览器/设备/生产灰度，无.env、安装依赖、迁移、服务或外部调用。shared及解析保持本树独立产物；没有改根或其他树node_modules。本片7文件：knowledge.ports.ts、knowledge-text-parser.ts、structured-memory.service.ts、knowledge-service.cjs、parser/memory两测试、本记录。S05继续，不更新AIN-10整项完成率。
