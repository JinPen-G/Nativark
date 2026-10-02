// Browser-only fixture: actual shared guard and router; no API or tenant data.
import "antd/dist/reset.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { createBrowserRouter, Link, RouterProvider } from "react-router-dom";
import { LocaleProvider } from "../src/app/locale";
import { UnsavedChangesGuard } from "../src/components/UnsavedChangesGuard";
function Editor() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return <><UnsavedChangesGuard dirty={Boolean(value)} busy={busy} />
    <h1>Category draft fixture</h1><input aria-label="Draft input" value={value} onChange={(event) => setValue(event.target.value)} />
    <button onClick={() => setValue("")}>Save fixture</button>
    <button onClick={() => setBusy(!busy)}>Toggle saving</button>
    <Link to="/guard-done">Leave editor</Link></>;
}
const router = createBrowserRouter([{ path: "/guard-done", element: <><h1>Destination fixture</h1><Link to="/tests/category-navigation.html">Edit again</Link></> }, { path: "*", element: <Editor /> }]);
createRoot(document.getElementById("root")!).render(<LocaleProvider><ConfigProvider><App><RouterProvider router={router} /></App></ConfigProvider></LocaleProvider>);
