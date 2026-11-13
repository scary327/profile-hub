import React from "react";
import ReactDOM from "react-dom/client";
import "./base.css";

async function boot() {
  // В обычном браузере (npm run dev без Tauri) подменяем бэкенд фейковыми данными.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    const { installMocks } = await import("./lib/mock");
    installMocks();
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  let label = "main";
  try {
    label = getCurrentWindow().label;
  } catch {
    /* вне Tauri — считаем, что это хаб */
  }

  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
  if (label === "game") {
    document.documentElement.dataset.window = "game";
    document.title = "Profile Hub — Игровой режим";
    const { GameMode } = await import("./game/GameMode");
    root.render(
      <React.StrictMode>
        <GameMode />
      </React.StrictMode>,
    );
  } else {
    document.documentElement.dataset.window = "hub";
    const { Hub } = await import("./hub/Hub");
    root.render(
      <React.StrictMode>
        <Hub />
      </React.StrictMode>,
    );
  }
}

void boot();
