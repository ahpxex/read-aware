import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

if (process.env.NODE_ENV === "development") {
  import("react-grab");
}

const isTauriRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isAppleWebKit =
  typeof navigator !== "undefined" &&
  /AppleWebKit/i.test(navigator.userAgent) &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

if (isTauriRuntime && isAppleWebKit) {
  document.documentElement.classList.add("tauri-wkwebview");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
