import type { CSSProperties } from "react";
import type { BrowserKind, LeaveBehavior, Profile, ProfileKind } from "../api";
import { hexToRgbTriplet, isHexColor } from "../lib/color";

const DEFAULT_ACCENT = "#7c5cff";

/** CSS-переменные --accent / --accent-rgb для цвета профиля. */
export function accentVars(color: string | null | undefined): CSSProperties {
  const c = color && isHexColor(color) ? color : DEFAULT_ACCENT;
  return { "--accent": c, "--accent-rgb": hexToRgbTriplet(c) } as CSSProperties;
}

/** JSON с отсортированными ключами — для сравнения объектов независимо от порядка полей. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Сравнение профилей; desktopId заполняет бэкенд, поэтому по умолчанию его не учитываем. */
export function profilesEqual(a: Profile | null, b: Profile | null, includeDesktop = false): boolean {
  if (!a || !b) return a === b;
  if (includeDesktop) return stableStringify(a) === stableStringify(b);
  return stableStringify({ ...a, desktopId: null }) === stableStringify({ ...b, desktopId: null });
}

export const KIND_LABEL: Record<ProfileKind, string> = {
  work: "Работа",
  gaming: "Игры",
};

export const LEAVE_OPTIONS: Array<{ value: LeaveBehavior; title: string; text: string }> = [
  {
    value: "keep",
    title: "Оставлять в фоне",
    text: "Окна остаются на своём виртуальном рабочем столе — вернётесь, и всё на месте.",
  },
  {
    value: "close",
    title: "Закрывать",
    text: "При уходе из профиля браузеры и приложения профиля закрываются.",
  },
  {
    value: "closeOnGaming",
    title: "Закрывать при входе в игры",
    text: "Между рабочими профилями всё остаётся, а при переходе в игровой — закрывается.",
  },
];

export const PROFILE_EMOJIS = [
  "💼", "💻", "🖥️", "⌨️", "🧑‍💻", "👨‍💻", "🚀", "🛠️", "⚙️", "🧪",
  "📊", "📈", "🗂️", "📁", "🏢", "🏠", "🌐", "☁️", "🔥", "⚡",
  "💡", "🧠", "🐍", "🦀", "☕", "🔒", "🎮", "🕹️", "👾", "🎯",
  "🏆", "🎧", "🎵", "🎬", "📚", "✏️", "🌙", "☀️", "🌿", "🌊",
  "🪐", "🦊", "🐱", "⭐", "💎", "❤️",
];

export const PROFILE_COLORS = [
  "#7c5cff", "#4f8cff", "#06b6d4", "#14b8a6", "#22c55e", "#84cc16",
  "#eab308", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#94a3b8",
];

export const BROWSER_COLORS: Record<BrowserKind, string> = {
  chrome: "#4285f4",
  edge: "#1fa3d6",
  firefox: "#ff7139",
  opera: "#ff1b2d",
  operaGx: "#fa1e4e",
  brave: "#fb542b",
  yandex: "#fc3f1d",
};

export const BROWSER_GLYPH: Record<BrowserKind, string> = {
  chrome: "C",
  edge: "E",
  firefox: "F",
  opera: "O",
  operaGx: "GX",
  brave: "B",
  yandex: "Я",
};

/** Имя файла без расширения: "C:\\Apps\\Code.exe" → "Code". */
export function baseName(path: string, stripExt = true): string {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  return stripExt ? name.replace(/\.[^.]+$/, "") : name;
}
