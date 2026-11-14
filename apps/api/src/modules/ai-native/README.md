# AI Native 服务端阅读入口

[应用providers](ai-native-application.providers.ts)把原持久事实、业务工具、Runtime、Gateway及权限适配接到请求场景，当前授权、预算、批准与Core动作各有自己的裁定位置。[请求绑定场景](scenes/request-bound-scenes.application.ts)是追踪真实用户入口与调用方的起点。

[任务runner](runner/ai-task-runner.service.ts)及[任务仓储](ai-task.repository.ts)维护Task/Run/Step、租约、等待、取消和原结果恢复。步骤工具从当前发布与原权限来源解析，草稿/准备、申请批准、获准执行及原收据分别保留。unknown按原引用核对，任务资源累计和财务模型账有各自的事实来源。

模型调用沿[唯一Gateway](public-ai-gateway.service.ts)和[预算组合](budget/gateway-budget.composition.ts)，Provider/Runtime专有类型留在适配。文件/知识访问、输出投影及业务事实不从模型内容授予权限。业务工具由所属Core当前规则执行，公共源码能力索引提供开发定位。[业务工具组合](tools/business-tools.composition.ts) · [开发工具基线](tool-baseline.ts)

当前模型与业务应用仍包含原Rental适配，PCH按已经固定的端口逐片抽离，原AI后续开发由其专项维护。Core可以不提供AI工具，运行Agent仅查已提供且当前获权的工具。[AI当前接续](../../../../../docs/AI%20Native/AI%20Native-协作接续.md) · [可选Core工具任务](../../../../../docs/平台底座/Core接入/平台Core接入-开发任务.md#ai-parallel-boundary)

API及客户端引用沿[正式shared出口](../../../../../packages/shared/src/index.ts)和[OpenAPI](../../contracts/openapi-document.ts)，验证从[任务应用](../../../../../tests/ai-native-task-application.test.cjs)、[模型宿主](../../../../../tests/ai-native-model-task-host.test.cjs)及所属小片现有入口选择。原[离线守卫](../../../../../tests/fixtures/ai-native/prisma-offline-preload.cjs)与实际环境授权先核对，类型/离线行为/真实数据库与供应商分别取证。
