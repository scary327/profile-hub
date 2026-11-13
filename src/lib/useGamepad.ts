import { useEffect, useRef, useState } from "react";

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
  | "folder";

export type PadType = "playstation" | "xbox";

export interface GamepadInfo {
  connected: boolean;
  type: PadType;
  id: string;
}

const INITIAL_DELAY = 350;
const REPEAT_DELAY = 110;
const STICK_THRESHOLD = 0.5;

/** Кнопки (стандартная раскладка W3C) → действия, срабатывают по нажатию. */
const BUTTON_ACTIONS: Array<[number, PadAction]> = [
  [0, "confirm"],
  [1, "back"],
  [3, "folder"],
  [4, "tabPrev"],
  [5, "tabNext"],
  [9, "menu"],
];

export function detectPadType(id: string): PadType {
  return /054c|dualsense|dualshock|wireless controller|playstation/i.test(id) ? "playstation" : "xbox";
}

type Dir = "up" | "down" | "left" | "right" | null;

function readDir(pad: Gamepad): Dir {
  const b = (i: number) => pad.buttons[i]?.pressed ?? false;
  if (b(12)) return "up";
  if (b(13)) return "down";
  if (b(14)) return "left";
  if (b(15)) return "right";
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  if (Math.abs(x) < STICK_THRESHOLD && Math.abs(y) < STICK_THRESHOLD) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? "right" : "left";
  return y > 0 ? "down" : "up";
}

function firstPad(): Gamepad | null {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p && p.connected) return p;
  return null;
}

/**
 * Опрашивает Gamepad API в requestAnimationFrame и превращает ввод в действия.
 * Направления повторяются при удержании (350 мс задержка, далее каждые 110 мс).
 * Ввод игнорируется, когда окно не в фокусе (например, запущена игра).
 */
export function useGamepad(onAction: (a: PadAction) => void, enabled = true): GamepadInfo {
  const cb = useRef(onAction);
  cb.current = onAction;
  const [info, setInfo] = useState<GamepadInfo>({ connected: false, type: "xbox", id: "" });

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let lastId = "";
    let prevButtons: boolean[] = [];
    let heldDir: Dir = null;
    let nextRepeat = 0;
    let wasFocused = true;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const pad = firstPad();
      const id = pad?.id ?? "";
      if (id !== lastId) {
        lastId = id;
        setInfo({ connected: !!pad, type: detectPadType(id), id });
        prevButtons = [];
        heldDir = null;
      }
      if (!pad) return;

      const focused = document.hasFocus() && !document.hidden;
      const pressed = pad.buttons.map((b) => b.pressed);
      if (!focused || !wasFocused) {
        // при возврате фокуса не реагируем на кнопки, которые уже были зажаты
        wasFocused = focused;
        prevButtons = pressed;
        heldDir = readDir(pad);
        nextRepeat = now + INITIAL_DELAY;
        return;
      }

      for (const [idx, action] of BUTTON_ACTIONS) {
        if (pressed[idx] && !prevButtons[idx]) cb.current(action);
      }
      prevButtons = pressed;

      const dir = readDir(pad);
      if (dir !== heldDir) {
        heldDir = dir;
        if (dir) {
          cb.current(dir);
          nextRepeat = now + INITIAL_DELAY;
        }
      } else if (dir && now >= nextRepeat) {
        cb.current(dir);
        nextRepeat = now + REPEAT_DELAY;
      }
    };
    raf = requestAnimationFrame(loop);
    const onConn = () => {
      /* сам цикл подхватит изменения; событие нужно, чтобы Chromium начал отдавать геймпад */
    };
    window.addEventListener("gamepadconnected", onConn);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("gamepadconnected", onConn);
    };
  }, [enabled]);

  return info;
}
