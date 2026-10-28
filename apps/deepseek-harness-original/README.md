# DeepSeek Harness 原始网页独立副本

此目录是最初下载的原版公开网站副本，用于后续单独制作开源底座官网。与相邻的 `deepseek-harness-clone`（已修改的 Rental OS 官网）完全独立，不导入或引用其 `rentalos/` 适配代码。

## 启动

安装 Node.js 18 或以上版本，双击 `start-preview.cmd`，或在此目录运行 `node serve.mjs`。

- 中文：http://127.0.0.1:8139/harness/
- 英文：http://127.0.0.1:8139/en/harness/
- 默认端口 8139，不占用当前 Rental OS 官网的 8138。命令行运行可用 `PORT` 环境变量指定其他端口。

浏览器语言及原站 `NEXT_LOCALE` Cookie 仍会影响默认语言，右上角可手动切换。需要 HTTP 服务才能运行原来的导航、动态模块和动效，不建议直接双击 HTML。

## 原版范围

`download-manifest.json` 中的 76 个文件按原目录复制，包含中英文 HTML、RSC 页面数据、Next.js 生产 JS、CSS、字体、图片、SVG、favicon，以及隐私政策和用户协议。所有文件 SHA-256 与最初下载清单一致，没有复制后新增的 Rental OS Logo、表单或改写内容。

`serve.mjs` 只提供本地访问和原站地区接口的本地快照适配。原始文件不修改，HTML 响应仅插入该适配脚本；`__mirror__/country.json` 不是访问者的实时地区。

这是网站的公开发布产物，不是作者的 React/Next.js 原始开发工程；演示界面不是可执行真实 AI 任务的后端。下载、GitHub、文档等外链仍指向原站，没有下载桌面安装包或外部站点。原站统计请求在离线或网络受限时可能失败。

目前保留原站品牌、文案和版权信息，尚未替换成开源底座官网，也不因复制而改变第三方素材的许可。
