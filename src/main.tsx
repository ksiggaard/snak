import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { QuickInput } from "./components/QuickInput";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// One bundle serves both windows; render by window label.
const isQuick = getCurrentWindow().label === "quick";
if (isQuick) document.documentElement.classList.add("overlay");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>{isQuick ? <QuickInput /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);

// Load runtime plugins in the main window only (the quick overlay has no plugin
// surfaces). Fire-and-forget after mount so first paint isn't blocked — plugins
// register their contributions into the live stores as they activate.
if (!isQuick) {
  void import("@/lib/pluginLoader").then((m) => m.loadEnabledPlugins());
}
