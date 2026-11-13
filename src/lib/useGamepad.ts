import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type PadAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "confirm"
  | "back"
  | "tabPrev"
  | "tabNext"
  | "menu"
  | "folder"
  /** Create/Share (DualSense, DS4) или View/Back (Xbox): голос и встроенный браузер. */
  | "voice";

export type PadType = "playstation" | "xbox";

export interface GamepadInfo {
  connected: boolean;
  type: PadType;
  id: string;
}

const INITIAL_DELAY = 350;
const REPEAT_DELAY = 110;
const STICK_THRESHOLD = 0.5;

/** Логические кнопки в терминах стандартной раскладки W3C. */
interface PadState {
  /** confirm, back, folder, tabPrev, tabNext, menu, voice (кнопка 8: Back/View/Share/Create) */
  buttons: Record<"confirm" | "back" | "folder" | "tabPrev" | "tabNext" | "menu" | "voice", boolean>;
  dir: Dir;
}

type Dir = "up" | "down" | "left" | "right" | null;

export function detectPadType(id: string): PadType {
  return /054c|dualsense|dualshock|wireless controller|playstation/i.test(id) ? "playstation" : "xbox";
}

function stickDir(x: number, y: number): Dir {
  if (Math.abs(x) < STICK_THRESHOLD && Math.abs(y) < STICK_THRESHOLD) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? "right" : "left";
  return y > 0 ? "down" : "up";
}

/**
 * Hat-переключатель DirectInput (так Chromium отдаёт крестовину DualSense/DS4
 * без стандартной раскладки): значения от -1 (вверх) по часовой с шагом 2/7,
 * «отпущено» ≈ 1.2857 (за пределами [-1, 1]).
 */
function hatDir(v: number | undefined): Dir {
  if (v === undefined || v < -1.05 || v > 1.05) return null;
  const idx = Math.round((v + 1) * 3.5); // 0..7: N, NE, E, SE, S, SW, W, NW
  return (["up", "right", "right", "down", "down", "left", "left", "up"] as const)[idx] ?? null;
}

function readState(pad: Gamepad): PadState {
  const b = (i: number) => pad.buttons[i]?.pressed ?? false;
  if (pad.mapping === "standard") {
    let dir: Dir = b(12) ? "up" : b(13) ? "down" : b(14) ? "left" : b(15) ? "right" : null;
    dir ??= stickDir(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    return {
      buttons: { confirm: b(0), back: b(1), folder: b(3), tabPrev: b(4), tabNext: b(5), menu: b(9), voice: b(8) },
      dir,
    };
  }
  if (detectPadType(pad.id) === "playstation") {
    // DirectInput-раскладка Sony: 0 □, 1 ✕, 2 ○, 3 △, 4 L1, 5 R1, 8 Create, 9 Options; крестовина — hat на axes[9]
    let dir = hatDir(pad.axes[9]);
    dir ??= stickDir(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    return {
      buttons: { confirm: b(1), back: b(2), folder: b(3), tabPrev: b(4), tabNext: b(5), menu: b(9), voice: b(8) },
      dir,
    };
  }
  // неизвестный нестандартный геймпад — лучшее предположение
  return {
    buttons: { confirm: b(0), back: b(1), folder: b(3), tabPrev: b(4), tabNext: b(5), menu: b(9), voice: b(8) },
    dir: stickDir(pad.axes[0] ?? 0, pad.axes[1] ?? 0),
  };
}

function firstPad(): Gamepad | null {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p && p.connected) return p;
  return null;
}

/** Диагностика в лог бэкенда (%LOCALAPPDATA%\tech.profilehub.app\logs). */
function debugLog(msg: string) {
  void invoke("debug_log", { msg }).catch(() => {});
}

/*
 * Web-вариант: опрашивает Gamepad API в requestAnimationFrame и превращает ввод в действия.
 * Направления повторяются при удержании (350 мс задержка, далее каждые 110 мс).
 * Ввод игнорируется, когда окно не в фокусе (например, запущена игра).
 * Фокус берём от самого окна Tauri: document.hasFocus() во WebView2 бывает false,
 * даже когда окно на переднем плане.
 */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Геймпад в игровом режиме. Внутри Tauri ввод читает Rust (gilrs / Windows.Gaming.Input):
 * Gamepad API во WebView2 не видит DualSense. В обычном браузере (dev-мок) — Web Gamepad API.
 */
export function useGamepad(onAction: (a: PadAction) => void, enabled = true): GamepadInfo {
  const native = useNativeGamepad(onAction, enabled && IN_TAURI);
  const web = useWebGamepad(onAction, enabled && !IN_TAURI);
  return IN_TAURI ? native : web;
}

function useNativeGamepad(onAction: (a: PadAction) => void, enabled: boolean): GamepadInfo {
  const cb = useRef(onAction);
  cb.current = onAction;
  const [info, setInfo] = useState<GamepadInfo>({ connected: false, type: "xbox", id: "" });

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const keep = (u: () => void) => (disposed ? u() : unlisteners.push(u));

    void invoke<GamepadInfo>("get_gamepad_info")
      .then((i) => !disposed && setInfo(i))
      .catch(() => {});
    void listen<GamepadInfo>("pad-info", (e) => setInfo(e.payload)).then(keep).catch(() => {});
    void listen<PadAction>("pad-action", (e) => cb.current(e.payload)).then(keep).catch(() => {});

    return () => {
      disposed = true;
      unlisteners.forEach((u) => u());
    };
  }, [enabled]);

  return info;
}

function useWebGamepad(onAction: (a: PadAction) => void, enabled: boolean): GamepadInfo {
  const cb = useRef(onAction);
  cb.current = onAction;
  const [info, setInfo] = useState<GamepadInfo>({ connected: false, type: "xbox", id: "" });

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let lastId = "";
    let prev: PadState | null = null;
    let heldDir: Dir = null;
    let nextRepeat = 0;
    let wasFocused = true;
    let windowFocused = true;
    let disposed = false;
    let unlistenFocus: (() => void) | undefined;

    const win = (() => {
      try {
        return getCurrentWindow();
      } catch {
        return null; // dev-мок в обычном браузере
      }
    })();
    if (win) {
      void win.isFocused().then((f) => (windowFocused = f)).catch(() => {});
      void win
        .onFocusChanged(({ payload }) => {
          windowFocused = payload;
        })
        .then((u) => (disposed ? u() : (unlistenFocus = u)))
        .catch(() => {});
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const pad = firstPad();
      const id = pad?.id ?? "";
      if (id !== lastId) {
        lastId = id;
        setInfo({ connected: !!pad, type: detectPadType(id), id });
        prev = null;
        heldDir = null;
        if (pad) debugLog(`gamepad: id="${pad.id}" mapping="${pad.mapping}" buttons=${pad.buttons.length} axes=${pad.axes.length}`);
        else debugLog("gamepad: отключён");
      }
      if (!pad) return;

      const focused = (windowFocused || document.hasFocus()) && !document.hidden;
      const st = readState(pad);
      if (!focused || !wasFocused || !prev) {
        // при возврате фокуса не реагируем на кнопки, которые уже были зажаты
        wasFocused = focused;
        prev = st;
        heldDir = st.dir;
        nextRepeat = now + INITIAL_DELAY;
        return;
      }

      for (const key of Object.keys(st.buttons) as Array<keyof PadState["buttons"]>) {
        if (st.buttons[key] && !prev.buttons[key]) cb.current(key);
      }
      prev = st;

      if (st.dir !== heldDir) {
        heldDir = st.dir;
        if (st.dir) {
          cb.current(st.dir);
          nextRepeat = now + INITIAL_DELAY;
        }
      } else if (st.dir && now >= nextRepeat) {
        cb.current(st.dir);
        nextRepeat = now + REPEAT_DELAY;
      }
    };
    raf = requestAnimationFrame(loop);

    const onConn = (e: GamepadEvent) => debugLog(`gamepadconnected: ${e.gamepad.id}`);
    window.addEventListener("gamepadconnected", onConn);
    debugLog(`gamepad poll start, hasFocus=${document.hasFocus()}`);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      unlistenFocus?.();
      window.removeEventListener("gamepadconnected", onConn);
    };
  }, [enabled]);

  return info;
}
