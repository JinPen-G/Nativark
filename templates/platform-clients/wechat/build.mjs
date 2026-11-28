/** 微信正式模板构建：只汇编已选入口与原生视图资产，不读取环境或启动服务。 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export function createWechatBuild(root, title) {
  const assets = name => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
  return {
    root, envDir: false,
    build: { outDir: 'dist', minify: false, target: 'es2018',
      rolldownOptions: { input: { app: resolve(root, 'app.ts'), 'pages/client/index': resolve(root, 'page.ts') },
        preserveEntrySignatures: 'strict', output: { format: 'cjs', entryFileNames: '[name].js', chunkFileNames: 'common/[name]-[hash].js' } } },
    plugins: [{ name: 'zelo-wechat-view', generateBundle() {
      const json = value => JSON.stringify(value, null, 2) + '\n';
      for (const [fileName, source] of Object.entries({
        'app.json': json({ pages: ['pages/client/index'], window: { navigationBarTitleText: title, navigationBarTextStyle: 'black', navigationBarBackgroundColor: '#ffffff' } }),
        'pages/client/index.json': json({ usingComponents: {} }),
        'pages/client/index.wxml': assets('view.wxml'), 'app.wxss': assets('view.wxss'),
      })) this.emitFile({ type: 'asset', fileName, source });
    } }],
  };
}
