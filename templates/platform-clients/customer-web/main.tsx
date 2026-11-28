import { createRoot } from "react-dom/client";
import { createClientRuntime, createClientView } from "@rental-os/platform-client-contracts";
import { createBrowserOperationStore } from "@rental-os/platform-client-web";
import { CustomerWebsite } from "@rental-os/platform-client-web/customer";
import "@rental-os/platform-client-web/styles.css";
import { assembleCustomer } from "./assembly";

const element = document.getElementById("root");
if (!element) throw new Error("缺少客户端挂载节点");
const root = createRoot(element), assembly = assembleCustomer();
if (!assembly) root.render(<main style={{ padding: 32 }}><h1>客户服务暂不可用</h1><p>请稍后重新打开。</p></main>);
else {
  const runtime = createClientRuntime({ ...assembly, surface: "customer-web" });
  let store;
  try { store = createBrowserOperationStore(window.localStorage, "customer-web"); } catch { /* 存储不可用仍可读取，写动作保持禁用。 */ }
  const view = createClientView(runtime, store);
  root.render(<CustomerWebsite view={view} brand={assembly.brand} />);
  void view.refreshSession();
  // 持有生命周期供实际宿主卸载；bfcache/后台进入由外壳处理，不能以卸载重发业务。
  window.addEventListener("pagehide", event => { if (!event.persisted) { root.unmount(); view.dispose(); runtime.dispose(); } }, { once: true });
}
