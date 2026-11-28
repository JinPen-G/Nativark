import { createRoot } from "react-dom/client";
import { createClientRuntime, createClientView } from "@rental-os/platform-client-contracts";
import { createBrowserOperationStore } from "@rental-os/platform-client-web";
import { StaffWeb } from "@rental-os/platform-client-web/staff";
import "@rental-os/platform-client-web/styles.css";
import { assembleStaff } from "./assembly";

const element = document.getElementById("root");
if (!element) throw new Error("缺少客户端挂载节点");
const root = createRoot(element);
let assembly: ReturnType<typeof assembleStaff>;
try { assembly = assembleStaff(); } catch { assembly = undefined; }
if (!assembly) root.render(<main style={{ padding: 32 }}><h1>门店服务暂不可用</h1><p>请稍后重新打开。</p></main>);
else {
  const runtime = createClientRuntime({ ...assembly, surface: "staff-web" });
  let store;
  try { store = createBrowserOperationStore(window.localStorage, assembly.operationNamespace); } catch { /* 持久定位不可用时仅开放读取。 */ }
  const view = createClientView(runtime, store);
  root.render(<StaffWeb view={view} brand={assembly.brand} />);
  void view.refreshSession();
  window.addEventListener("pagehide", event => { if (!event.persisted) { root.unmount(); view.dispose(); runtime.dispose(); } }, { once: true });
}
