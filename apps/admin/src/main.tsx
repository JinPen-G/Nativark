/**
 * 职责：加载管理后台样式并挂载 React 应用；页面与路由由 app 目录管理。
 * 边界：保持 UIArc 样式加载顺序；业务权限不在此判定，菜单隐藏不替代 API 鉴权。
 * 修改界面前读取本端 AGENTS.md，复用现有组件适配，不另建后台外壳。
 */
import "antd/dist/reset.css";
import "@/registry/foundation.css";
import "./styles.css";
import "./components/ui/arc-bridge.css";
import "./components/ui/input-radius.css";
import "./components/ui/input-colors.css";
import "./components/ui/control-metrics.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
