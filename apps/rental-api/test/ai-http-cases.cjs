'use strict';
/** 实际 Controller 元数据、原 Guard 路由和同源文档的交叉核验；不启动 HTTP。 */
module.exports = async function runCases({ t, lock }) {
  const assert = require('node:assert/strict');
  const shared = require('@rental-os/shared');
  const { matchableRequestPath } = require('@rental-os/platform-server/request-path');
  const { HTTP_CODE_METADATA } = require('@nestjs/common/constants');
  const { createRentalAuthorization } = require('@rental-os/rental-core/http-auth');
  const { createRentalStaffPolicy } = require('@rental-os/rental-core/staff-api-policy');
  const { RENTAL_AI_CONTROLLERS, RENTAL_AI_INSPECTION_OPERATIONS, RENTAL_AI_MOUNTED_REQUESTS,
    createRentalAiHttpPolicy, rentalAiDeploymentContinuationSelector } = require('../src/ai-http-policy.ts');
  const { AiOriginalQuoteModelExecutionController, AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS,
    AiScenePlanPolicyController, AiOriginalTaskActionPolicyController, AI_SCENE_PLAN_POLICIES, AI_ORIGINAL_TASK_ACTION_POLICIES,
    AiOriginalSceneModelActionsController, AiOriginalSceneModelController } =
    require('@rental-os/ai-native-server/runtime/scenes/original-scenes.controller');
  const { AiOriginalOpeningModelExecutionController, AI_ORIGINAL_OPENING_MODEL_REQUESTS } =
    require('@rental-os/ai-native-server/runtime/scenes/opening-model-execution.controller');
  const { AiOriginalOrderReadController, AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS } =
    require('@rental-os/ai-native-server/runtime/scenes/original-order-read.controller');
  const { createRentalAiOpenApi } = require('../src/ai-openapi.ts');
  await t.test('部署停新只保留原登记历史/控制/收尾路径，普通新工作仍关闭', () => {
    const policy = createRentalAiHttpPolicy(), selector = rentalAiDeploymentContinuationSelector(policy);
    const check = (controllerName, name, expected) => {
      const route = policy.routes.find(route => route.controller.name === controllerName && route.handlerName === name);
      assert(route, controllerName + '.' + name);
      const url = '/api' + route.path.replace(/:[^/]+/gu, 'original-a');
      assert.equal(selector.isHandler(route.controller, route.handler), expected, controllerName + '.' + name);
      assert.equal(selector.isRoute({ method: route.method, url }), expected, url);
      assert.equal(selector.isRoute({ method: 'DELETE', url }), false);
      assert.equal(selector.isRoute({ method: route.method, url: url + '/unexpected' }), false);
      assert.equal(selector.isRoute({ method: route.method, url: url + '?deploymentContinuation=true&originalRecovery=true' }), expected);
    };
    for (const name of ['snapshot', 'stop', 'decision', 'decisionReceipt']) check('AiTaskCenterController', name, true);
    for (const name of ['continue', 'resumeInput', 'continueInput']) check('AiTaskCenterController', name, false);
    for (const name of ['recover', 'reconcile', 'requestCancel', 'readExecution']) check('AiOriginalOpeningModelExecutionController', name, true);
    for (const name of ['start', 'takeover']) check('AiOriginalOpeningModelExecutionController', name, false);
    for (const name of ['readOrderMaterialReceipt', 'readTaskCreation', 'recoverTaskModel', 'reconcileTaskModel'])
      check('RentalWebsiteClientEntryController', name, true);
    for (const name of ['prepareOrderMaterial', 'createTask', 'startTaskModel', 'submitTaskInput', 'continueTaskInput'])
      check('RentalWebsiteClientEntryController', name, false);
    // 员工检查已按原操作分开挂载，不能再把旧 consume 分发器当一个可恢复处理器。
    for (const name of ['draftRead', 'submissionRead', 'submissionPreparation'])
      check('RentalStaffInspectionAssistController', name, true);
    for (const name of ['draftCreate', 'submissionPrepare', 'submissionSubmit', 'evidenceBind'])
      check('RentalStaffInspectionAssistController', name, false);
    assert(!policy.routes.some(route => route.controller.name === 'StaffInspectionAssistController'));
    assert.equal(selector.isRoute({ method: 'POST', url: '/api/' + shared.AI_STAFF_INSPECTION_HTTP_DRAFT.basePath + '/unknown' }), false);
    assert.equal(selector.isRoute({ method: 'POST', url: '/api/rental/v1/unknown?recover=true' }), false);
  });
  await t.test('实际 AI 路由具有原权限、正确成功状态和完整文档引用', () => {
    const authorization = createRentalAuthorization(shared), staff = createRentalStaffPolicy(shared);
    const policy = createRentalAiHttpPolicy(authorization);
    policy.assertReviewed();
    const document = createRentalAiOpenApi(lock, policy);
    const routes = policy.routes.filter(route => RENTAL_AI_CONTROLLERS.includes(route.controller));
    // A published execution must resolve its original dedicated factory. Mounting
    // the broad legacy controller alongside it would give the same task two drivers.
    for (const [controller, token, count] of [
      [AiOriginalQuoteModelExecutionController, AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS, 13],
      [AiOriginalOpeningModelExecutionController, AI_ORIGINAL_OPENING_MODEL_REQUESTS, 6],
      [AiOriginalOrderReadController, AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS, 17],
      [AiScenePlanPolicyController, AI_SCENE_PLAN_POLICIES, 2],
      [AiOriginalTaskActionPolicyController, AI_ORIGINAL_TASK_ACTION_POLICIES, 3],
    ]) {
      assert(RENTAL_AI_CONTROLLERS.includes(controller));
      assert.equal(RENTAL_AI_MOUNTED_REQUESTS.filter(value => value === token).length, 1);
      assert.equal(routes.filter(route => route.controller === controller).length, count);
    }
    assert(!RENTAL_AI_CONTROLLERS.includes(AiOriginalSceneModelActionsController));
    assert(!RENTAL_AI_CONTROLLERS.includes(AiOriginalSceneModelController));
    const identities = routes.map(route => route.method + ' ' + route.path);
    assert.equal(new Set(identities).size, identities.length, 'each original path has one mounted handler');
    let operations = 0, references = 0;
    for (const route of routes) {
      const paths = route.handlerName === 'consume'
        ? RENTAL_AI_INSPECTION_OPERATIONS.map(operation => route.path.replace(':operation', operation)) : [route.path];
      for (const path of paths) {
        const permissions = path.startsWith('/staff/v1/') ? staff.staffRoutePermissions(route.method, path)
          : authorization.requiredPermissions(route.method, path);
        assert(permissions && !permissions.includes(authorization.UNMATCHED_ROUTE_PERMISSION), route.controller.name + '.' + route.handlerName);
        // 文档保留 closeUnstarted 等原合同拼写，路由按原 Express/Guard 语义小写比较。
        const matching = Object.entries(document.paths).filter(([key, methods]) =>
          matchableRequestPath(key) === path.replace(/:([\w]+)/g, '{$1}') && methods[route.method.toLowerCase()]);
        assert.equal(matching.length, 1, '每个实际路由须有唯一同源文档：' + path);
        const documented = matching[0][1][route.method.toLowerCase()];
        assert(documented, '缺同源文档：' + path);
        const expected = Reflect.getMetadata(HTTP_CODE_METADATA, route.handler) ?? (route.method === 'POST' ? 201 : 200);
        assert(documented.responses[expected], '成功状态须与原 Controller 一致：' + path + ' ' + expected);
        operations++;
      }
    }
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (typeof value.$ref === 'string' && value.$ref.startsWith('#/components/schemas/')) {
        references++;
        assert(Object.hasOwn(document.components.schemas, value.$ref.slice(21)), value.$ref);
      }
      Object.values(value).forEach(visit);
    }
    visit(document);
    assert.deepEqual(document['x-aiNativeDocumentationGaps'], []);
    for (const action of ['reissue', 'reconcileReissue']) {
      const path = '/' + shared.AI_SCENE_REQUEST_HTTP_DRAFT.basePath + '/' + shared.AI_SCENE_REQUEST_HTTP_DRAFT[action];
      assert.deepEqual(authorization.requiredPermissions('POST', path), ['rental-os:order:view', 'rental-os:order:create']);
      assert(authorization.requiredPermissions('POST', path + '/unexpected').includes(authorization.UNMATCHED_ROUTE_PERMISSION));
    }
    for (const action of ['requestCancellationIntent', 'settleUnstartedCancellation', 'settleReleasedInputCancellation']) {
      const path = '/' + shared.AI_SCENE_MODEL_HTTP_DRAFT.basePath + '/' + shared.AI_SCENE_MODEL_HTTP_DRAFT[action];
      assert.deepEqual(authorization.requiredPermissions('POST', path), ['rental-os:order:view']);
      assert(authorization.requiredPermissions('GET', path).includes(authorization.UNMATCHED_ROUTE_PERMISSION));
      assert(authorization.requiredPermissions('POST', path + '/unexpected').includes(authorization.UNMATCHED_ROUTE_PERMISSION));
    }
    console.log(JSON.stringify({ aiControllers: RENTAL_AI_CONTROLLERS.length, documentedOperations: operations, references }));
  });
};
