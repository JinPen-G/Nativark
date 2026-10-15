# 通知设置持久等待引用交接（CA06/07 接续）

唯一施工树 codex-ai-native-lane-a，分支 ai/codex-ai-native-lane-a-20261007。476ccf01 已由主线整合3580f989；本片仅安全同步主线明确给定701d12c2f3f1d4abed7330fb99e09bb12f357bc9，实际fast-forward，历史和output完整保留，无MERGE_HEAD、无冲突。同步带入的B/runner等既有源码不属于本片维护范围，未修改它们。

## 已接通

原 `composeAiAuthorizedBusinessTools(...).settingsActions.read/humanHandoff` 内部消费原 `settingsHost.application.readConfirmation({taskId,runId,stepId})`。仅当前 waiting_confirmation 且原准备收据存在时读取；严格比对 task/run/step、taskRevision、proposalId/revision/reviewedPayloadHash，以及原 execution:not_attested。最终聚合前重读原持久等待引用，不借 step.resultRef、客户端checkpoint或私造键替代服务器记录。

人类交接返回原 confirmation（含服务器 checkpointRef/taskRevision），原审阅与决定/操作回执仍分开。原来缺 `current_server_checkpoint_reference` 的正常等待场景现在missing=[]；没有当前等待时明确 `current_server_wait_unavailable`，终态confirmation=null，不让旧等待引用复活。

不调用 start/continueConfirmation/decide/claim，不发布输入、不写审批或Core。引用读取不批准、不领取租约、不授执行权限；未来宿主显式人类续跑仍必须经原continueConfirmation及其原恢复前提，本片不代行。未来Runtime与Provider SDK替换边界独立，当前均未安装/迁移。

## 实际验证

离线环境：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline，AI_OFFLINE_WRITE_ROOT为本树绝对路径，AI_OFFLINE_AUDIT=本树output/ca-settings-checkpoint.audit（类型检查另ca-settings-checkpoint-types.audit），TEMP/TMP=本树output/entry-booking-tmp。

`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='settings normal host starts' tests/ai-native-plan-input-source.test.cjs`

pass=1/fail=0/skip=0/todo=0/cancelled=0，退出码0。复用原正常完整链测试，新增消费者返回原checkpoint、taskRevision/提案hash、not_attested、拒绝客户端checkpoint以及终态不复活断言；原错步骤/撤权/终态拒绝也保留。日志中的AI_RESOURCE_UNAVAILABLE为assert.rejects预期拒绝诊断，不是被吞掉的失败。没有新脚本或大矩阵，本片未虚构红测。

类型检查命令（PowerShell先设置上述环境）：

```text
node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e 'const ts=require(require.resolve("typescript",{paths:[process.cwd()+"/apps/api"]}));const path=require("path");const root=process.cwd();const config=ts.readConfigFile("apps/api/tsconfig.json",ts.sys.readFile);if(config.error)throw Error(ts.flattenDiagnosticMessageText(config.error.messageText,"\n"));const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,path.join(root,"apps/api"));const options={...parsed.options,noEmit:true,incremental:false,rootDir:root,paths:{...parsed.options.paths,"@rental-os/shared":[path.join(root,"packages/shared/src/index.ts")],"@prisma/client":[path.join(root,"apps/api/node_modules/@prisma/client/index.d.ts")]}};const program=ts.createProgram(parsed.fileNames,options);const ds=ts.getPreEmitDiagnostics(program);for(const d of ds)process.stdout.write(ts.flattenDiagnosticMessageText(d.messageText,"\n")+"\n");process.stdout.write("ROOTS="+parsed.fileNames.length+" DIAGNOSTICS="+ds.length+"\n");process.exitCode=ds.length?1:0;'
```

实际523入口、0诊断、退出码0；`git diff --check`退出码0。这是noEmit源码映射检查，不生成共享产物、不冒称未运行的API打包通过。

## 未接与证据边界

原生产宿主/正式HTTP未启用；通知以外分区及客户资料写动作不在本片开放范围。确认引用是当前只读观察，不是未来调用可以跳过权限、配置修订、租约、批准与Core复核的凭证。

离线测试替身只提供数据库/Core持久事实，消费者、权限适配、原runner/审批/收据逻辑实际执行；没有真实MySQL锁、真实迁移、HTTP/模型/支付、浏览器或设备验收。不调整CA/原AIN整项完成率，不修改中央文档。
