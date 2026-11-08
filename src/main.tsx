import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/globals.css";
import App from "./App";

function render() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// In a plain browser during development, swap in a fake backend so the UI can be
// checked without Tauri. Production builds drop this branch entirely.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  void import("./dev/mock").then((m) => m.installMock()).then(render);
} else {
  render();
}
