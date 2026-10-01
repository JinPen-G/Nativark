import "antd/dist/reset.css";
import "@/registry/foundation.css";
import "./styles.css";
import "./components/ui/arc-bridge.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
