'use strict';
/** 实际 Controller 元数据、原 Guard 路由和同源文档的交叉核验；不启动 HTTP。 */
module.exports = async function runCases({ t, lock }) {
  const assert = require('node:assert/strict');
  const shared = require('@rental-os/shared');
  const { HTTP_CODE_METADATA } = require('@nestjs/common/constants');
  const { createRentalAuthorization } = require('@rental-os/rental-core/http-auth');
  const { createRentalStaffPolicy } = require('@rental-os/rental-core/staff-api-policy');
  const { RENTAL_AI_CONTROLLERS, RENTAL_AI_INSPECTION_OPERATIONS, RENTAL_AI_MOUNTED_REQUESTS,
    createRentalAiHttpPolicy } = require('../src/ai-http-policy.ts');
  const { AiOriginalQuoteModelExecutionController, AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS,
    AiScenePlanPolicyController, AiOriginalTaskActionPolicyController, AI_SCENE_PLAN_POLICIES, AI_ORIGINAL_TASK_ACTION_POLICIES,
    AiOriginalSceneModelActionsController, AiOriginalSceneModelController } =
    require('@rental-os/ai-native-server/runtime/scenes/original-scenes.controller');
  const { AiOriginalOpeningModelExecutionController, AI_ORIGINAL_OPENING_MODEL_REQUESTS } =
    require('@rental-os/ai-native-server/runtime/scenes/opening-model-execution.controller');
  const { AiOriginalOrderReadController, AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS } =
    require('@rental-os/ai-native-server/runtime/scenes/original-order-read.controller');
  const { createRentalAiOpenApi } = require('../src/ai-openapi.ts');
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
        const documented = document.paths['/api' + path.replace(/:([\w]+)/g, '{$1}')]?.[route.method.toLowerCase()];
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
