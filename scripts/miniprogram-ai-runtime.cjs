'use strict';
/** Produce one customer-contract bundle in memory. Only canonical shared code
 * and its existing validator dependency may enter it; no services, arbitrary
 * shared entry, node_modules copy, browser global shim or output cache. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const exportsAllowed = Object.freeze([
  'AI_CLIENT_PUBLIC_HTTP', 'aiClientPublicSessionRequestSchema', 'aiClientPublicReadRequestSchema',
  'aiClientPublicPreparationRequestSchema', 'aiClientPublicOperationRequestSchema', 'aiClientPublicContinuationRequestSchema',
  'aiClientPublicContinuationReadRequestSchema', 'aiClientPublicSessionResponseSchema', 'aiClientPublicReadResponseSchema',
  'aiClientPublicPreparationResponseSchema', 'aiClientPublicOperationResponseSchema', 'aiClientPublicContinuationResponseSchema',
  'createAiClientPublicContinuitySession',
  'aiClientGoalPreparationRequestSchema', 'aiClientGoalPreparationReadRequestSchema', 'aiClientGoalPreparationResponseSchema',
  'aiClientGoalCandidatesRequestSchema', 'aiClientGoalProjectionSchema', 'aiClientGoalQuoteRequestSchema',
  'aiClientGoalQuoteReferenceSchema', 'aiClientGoalQuoteReadResponseSchema', 'aiClientTaskInputReferenceRequestSchema', 'clientTaskInputReference', 'minimizeClientRecoveryRecord',
  'createClientGoalSession', 'clientGoalStorageKey', 'clientGoalSelectedInput', 'clientGoalTimeOptions', 'clientGoalTextHash',
  'enterpriseOrderDelegationMatches',
  'AI_CLIENT_ENTRY_HTTP_DRAFT', 'AI_CLIENT_HOST_CAPABILITIES_VERSION', 'AI_CLIENT_QUOTE_PREPARATION_VERSION',
  'AI_CLIENT_QUOTE_BOOKING_VERSION', 'aiClientHostCapabilitiesRequestSchema', 'aiClientHostCapabilitiesSchema',
  'aiClientQuotePreparationRequestSchema', 'aiClientQuoteConfirmationRequestSchema', 'aiClientQuotePreparationResponseSchema',
  'aiClientQuotePreparationReadResponseSchema', 'aiClientQuoteResultReadResponseSchema', 'aiClientQuoteBookingRequestSchema',
  'aiClientQuoteParameterReviewSchema', 'RENTAL_PRICING_UNIT_LABELS',
  'AI_CLIENT_BOOKING_TRANSFER_VERSION', 'aiClientBookingTransferIssueRequestSchema', 'aiClientBookingTransferRequestSchema',
  'aiClientBookingTransferIssueResponseSchema', 'aiClientBookingTransferReceiptSchema',
  'aiClientQuoteBookingPreparationResponseSchema', 'aiClientQuoteBookingOperationResponseSchema',
  'aiBookingSelectionSchema', 'aiEntryActionSchema', 'aiBookingDraftSchema', 'aiBookingHandoffSchema',
  'aiBookingCreateResponseSchema', 'aiBookingChoiceResponseSchema', 'aiBookingHandoffResponseSchema', 'aiBookingOperationReadResponseSchema',
  'AI_TASK_DRAFT_VERSION', 'AI_TASK_INPUT_DRAFT_VERSION', 'AI_TASK_INPUT_FIELD_IDS_DRAFT',
  'isAiTaskInputContractDraft', 'isAiTaskInputSubmissionDraft',
  'aiClientOrderMaterialRequestSchema', 'aiClientOrderMaterialReceiptSchema',
  'aiClientOrderActionSourceSchema', 'aiClientOrderActionSchema', 'aiClientOrderActionRevalidationSchema',
  'aiClientTaskReadRequestSchema', 'aiClientTaskCreationReceiptSchema',
  'aiClientTaskEventsReadRequestSchema', 'aiClientTaskSnapshotReadResponseSchema', 'aiClientTaskEventsReadResponseSchema',
  'aiClientTaskModelControlResponseSchema', 'aiClientTaskModelResultReadResponseSchema',
  'aiClientTaskInputReadResponseSchema', 'aiClientTaskInputSubmissionRequestSchema',
  'aiClientTaskInputSubmissionReceiptSchema', 'aiClientTaskInputReceiptReadResponseSchema',
  'aiClientTaskCancelRequestSchema', 'aiClientTaskCancelReceiptSchema', 'aiClientTaskCancellationObservationSchema',
  'aiClientTaskInputCancellationReceiptSchema', 'aiClientTaskUnstartedCancellationReceiptSchema'
]);
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const entryActionExports = Object.freeze(['AI_REGISTERED_ENTRY_ACTION_VERSION', 'AI_REGISTERED_ENTRY_ACTION_HTTP',
  'aiRegisteredEntryActionOrderSourceSchema', 'aiRegisteredEntryActionOrderResponseSchema',
  'aiRegisteredEntryActionReadSchema', 'aiRegisteredEntryActionRevalidationSchema']);
const bundles = {
  customer: { entry: 'miniprogram-client.ts', output: 'index.js', exports: exportsAllowed },
  entry_actions: { entry: 'miniprogram-entry-actions.ts', output: 'entry-action-runtime.js', exports: entryActionExports },
  scene_catalog: { entry: 'miniprogram-scene-catalog.ts', output: 'scene-catalog-runtime.js', exports: [
    'AI_ENTRY_SCENE_CATALOG_VERSION', 'AI_ENTRY_SCENE_CATALOG_HTTP', 'isAiEntrySceneCatalogRequest',
    'isAiEntrySceneCatalogResponse', 'entrySceneAvailabilityLabel'] },
};
async function buildNativeContractRuntime(appRoot, kind) {
  appRoot = path.resolve(appRoot);
  const projectRoot = path.resolve(appRoot, '../..');
  if (!Object.hasOwn(bundles, kind)
    || ![path.join(projectRoot, 'apps', 'miniprogram'), ...(kind !== 'customer'
      ? [path.join(projectRoot, 'apps', 'staff-miniprogram')] : [])].includes(appRoot)) throw Error('Unexpected native contract root');
  const resolve = name => require.resolve(name, { paths: [appRoot, projectRoot] });
  const webpack = require(resolve('webpack')), TerserPlugin = require(resolve('terser-webpack-plugin'));
  const { Volume, createFsFromVolume } = require(resolve('memfs'));
  const sourceRoot = fs.realpathSync(path.join(projectRoot, 'packages/shared/src'));
  const zodRoot = fs.realpathSync(path.dirname(resolve('zod/package.json')));
  const bundle = bundles[kind], entry = path.join(sourceRoot, bundle.entry);
  const license = fs.readFileSync(path.join(zodRoot, 'LICENSE'), 'utf8');
  const outputPath = kind === 'customer' ? path.join(appRoot, 'dist', 'vendor', 'shared-ai-client')
    : path.join(appRoot, 'dist', 'components', 'ai-native');
  const outputName = bundle.output;
  const memory = createFsFromVolume(new Volume());
  memory.join = path.join.bind(path);
  const sources = new Set();
  const compiler = webpack({
    mode: 'production', context: projectRoot, target: ['web', 'es2019'], cache: false, devtool: false,
    entry, output: { path: outputPath, filename: outputName, library: { type: 'commonjs2' },
      chunkLoading: false, wasmLoading: false, clean: false },
    resolve: { extensions: ['.ts', '.js', '.mjs', '.cjs'], mainFields: ['module', 'browser', 'main'],
      conditionNames: ['import', 'module', 'default'] },
    module: { rules: [{ test: /\.ts$/u, include: sourceRoot,
      use: [{ loader: path.join(projectRoot, 'apps/miniprogram/scripts/shared-runtime-loader.cjs') }] }] },
    optimization: { minimize: true, splitChunks: false, runtimeChunk: false,
      minimizer: [new TerserPlugin({ parallel: false, extractComments: false, terserOptions: { format: { comments: /^!/u } } })] },
    plugins: [new webpack.BannerPlugin({ banner: `Canonical Rental OS customer contract runtime.\nIncludes Zod under its original license:\n${license}`,
      entryOnly: true }), {
      apply(instance) {
        instance.hooks.compilation.tap('ClientContractSourceBoundary', compilation => {
          compilation.hooks.finishModules.tap('ClientContractSourceBoundary', modules => {
            for (const module of modules) {
              if (module.externalType) { compilation.errors.push(Error('External dependency in native client runtime')); continue; }
              if (!module.resource) continue;
              const real = fs.realpathSync(module.resource.split('?')[0]);
              if (!inside(sourceRoot, real) && !inside(zodRoot, real))
                compilation.errors.push(Error(`Unapproved client runtime source: ${real}`));
              else sources.add(real);
            }
          });
        });
      }
    }], infrastructureLogging: { level: 'error' }, stats: 'errors-only'
  });
  compiler.outputFileSystem = memory;
  await new Promise((resolveRun, reject) => {
    compiler.run((error, stats) => {
      compiler.close(closeError => {
        if (error || closeError) { reject(error || closeError); return; }
        if (!stats || stats.hasErrors()) { reject(Error(stats?.toString({ all: false, errors: true }) || 'Native runtime build failed')); return; }
        resolveRun();
      });
    });
  });
  const code = memory.readFileSync(path.join(outputPath, outputName), 'utf8');
  const bytes = Buffer.byteLength(code, 'utf8');
  if (bytes > 400000 || /\brequire\s*\(/u.test(code) || /(?:node:|@rental-os\/shared)/u.test(code))
    throw Error('Native runtime is oversized or retains an external runtime dependency');
  // No synthetic browser/Node polyfills: module evaluation must be inert on a
  // host without these globals. Actual schema behavior has separate smoke evidence.
  const sandbox = { module: { exports: {} }, exports: {}, URL: undefined, TextEncoder: undefined,
    Buffer: undefined, process: undefined, window: undefined, document: undefined, structuredClone: undefined };
  vm.runInNewContext(code, sandbox, { timeout: 2000, filename: 'shared-ai-client/index.js' });
  const names = Object.keys(sandbox.module.exports).sort();
  if (JSON.stringify(names) !== JSON.stringify([...bundle.exports].sort()))
    throw Error('Native contract export whitelist mismatch');
  const sourceHashes = [...sources].sort().map(file => ({ file: inside(sourceRoot, file)
    ? `shared/${path.relative(sourceRoot, file).replace(/\\/g, '/')}`
    : `zod/${path.relative(zodRoot, file).replace(/\\/g, '/')}`,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
  return { code, bytes, sha256: crypto.createHash('sha256').update(code).digest('hex'), sourceHashes };
}
const buildMiniprogramAiRuntime = appRoot => buildNativeContractRuntime(appRoot, 'customer');
const buildEntryActionRuntime = appRoot => buildNativeContractRuntime(appRoot, 'entry_actions');
const buildSceneCatalogRuntime = appRoot => buildNativeContractRuntime(appRoot, 'scene_catalog');
module.exports = { buildMiniprogramAiRuntime, buildEntryActionRuntime, buildSceneCatalogRuntime, exportsAllowed, entryActionExports };
