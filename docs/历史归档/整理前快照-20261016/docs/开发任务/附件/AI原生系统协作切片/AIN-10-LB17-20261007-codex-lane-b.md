# AIN-10 LB17 本批离线交接证据

唯一施工树codex-ai-native-lane-b，分支ai/codex-ai-native-lane-b-20261007。固定主线0aeea679经42e18ec5整合；此前五片提交全部保留，历史测试不累计为本轮结果。三份主文档、中央索引、其他工作树未修改。

## 实现与文件归属

- c76a6197：knowledge/knowledge-source.service.ts、下载绑定测试、LB15记录。修复适配器修改文档别名后把另一附件当作原授权附件的缺陷；固定调用上下文和返回引用，复读当前head。不生成下载URL。
- 6dffadb2：knowledge/knowledge-document.service.ts、解析未知测试、LB16记录。pending解析操作收据重放保持result_unknown/reconcile，不视作完成、不重读文件或派发解析。
- 本片强化解析未知测试：实际KnowledgeDocumentService + PrismaKnowledgeRepository，只有数据库执行使用dbFactory事务替身。已提交pending标记后丢失应答，重复操作不得额外提交或读取附件。不是只测内存仓储。

红测分别1 fail（下载附件替换）、1 fail（pending被当作完成），均退出1；修复后的阶段40/40、52/52见LB15/LB16。强化Prisma解析测试单独1/1、退出0。

## 本轮扩大回归

环境固定DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；NODE_OPTIONS加载本树绝对tests/fixtures/ai-native/prisma-offline-preload.cjs及lane-b-local-runtime.cjs；AI_OFFLINE_AUDIT使用本树output内绝对路径。

命令：PowerShell `$files=Get-ChildItem tests/ai-native-knowledge-*.test.cjs,tests/ai-native-memory-*.test.cjs | ForEach-Object {$_.FullName}`，随后`node --test --test-concurrency=2 $files`。

实际204 pass、0 fail、0 cancelled、0 skip、0 todo，退出0，169939ms。运行期间强化了解析测试，因此这不是提交冻结后的整轮证明；最终强化用例另单独重跑，不能把204项宣称为主线全量验收。

## 类型检查与命令失败

1. 顶层node_modules/typescript/bin/tsc路径不存在：MODULE_NOT_FOUND，退出1，未安装依赖。
2. 通过require('typescript/bin/tsc')执行原API tsconfig：退出1；解析到旧shared构建产物，缺AI公开类型等。没有修改或生成共享产物来消除错误。
3. 使用现有TypeScript编译器API读取原apps/api/tsconfig.json，保持原严格选项，设置noEmit=true、incremental=false、rootDir/baseUrl为本树，paths显式指向本树packages/shared/src/index.ts与apps/api/node_modules/@prisma/client/index.d.ts。createProgram后getPreEmitDiagnostics：API_ISOLATED_DIAGNOSTICS=0，退出0。是隔离源代码类型检查，不是普通构建通过。知识目录strict noEmit也包含在相关生命周期回归。
4. 最终复跑首次NODE_OPTIONS使用Windows反斜杠，Node解析后预加载路径丢失分隔符，MODULE_NOT_FOUND退出1、未执行测试；改用绝对正斜杠路径重跑，不放宽护栏。

最终固定源码命令：`node --test tests/ai-native-knowledge-lane-b-parse-unknown.test.cjs tests/ai-native-knowledge-lane-b-download-binding.test.cjs`。4 pass、0 fail/cancelled/skip/todo，退出0，14631ms。`git diff --check`退出0；只存在本片测试及记录修改，无其他WIP。

## 主线硬依赖与未验

LB15列出的正式KnowledgeAction/MemoryAction权限及ACL修订来源、有界文件读取/知识资源归属入口、人类确认生产/撤销入口仍缺，未凭空实现授权。正式适配保持unavailable；身份服务存在不等于有文档权限。未知pending解析的正式核对/恢复端口仍待接通，不自动重派。

现有持久组合测试已覆盖撤回/ACL收窄/索引收据重放和提交应答丢失。缓存清除是单进程机制；当前授权与head复读拒绝旧内容不等于分布式失效广播已实现。没有扩建评测平台、向量库或绕过文件服务。

未读.env、未启服务、未连接真实HTTP/DNS/DB/模型/支付、未执行迁移、未修改共享生成物；未验真实MySQL锁/宕机、多实例传播、真实文件存储与HTTP/模型。作者自查不等于独立复核，不更新完成率，不宣称AIN-04/10/24结项。
