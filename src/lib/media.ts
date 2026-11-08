import { convertFileSrc } from "@tauri-apps/api/core";

/** URL the webview can load for a local file (asset protocol, scoped in Rust). */
export const fileSrc = (path: string) => (path.startsWith("data:") ? path : convertFileSrc(path));
