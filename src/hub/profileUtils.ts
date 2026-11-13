import type { CSSProperties } from "react";
import type { BrowserKind, HubState, LeaveBehavior, Profile, ProfileKind, WinUserInfo } from "../api";
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

/**
 * Сравнение профилей. windowsUser меняется отдельными командами (создать/привязать/отвязать),
 * а не кнопкой «Сохранить», поэтому по умолчанию в «грязность» черновика не входит.
 */
export function profilesEqual(a: Profile | null, b: Profile | null, includeAccount = false): boolean {
  if (!a || !b) return a === b;
  if (includeAccount) return stableStringify(a) === stableStringify(b);
  return stableStringify({ ...a, windowsUser: null }) === stableStringify({ ...b, windowsUser: null });
}

export const KIND_LABEL: Record<ProfileKind, string> = {
  work: "Работа",
  gaming: "Игры",
};

export const LEAVE_OPTIONS: Array<{ value: LeaveBehavior; title: string; text: string }> = [
  {
    value: "keep",
    title: "Оставлять сеанс в фоне",
    text: "Программы продолжают работать — вернётесь быстро, и всё на месте.",
  },
  {
    value: "signOut",
    title: "Выходить из учётки",
    text: "При уходе из профиля всё закрывается, освобождается память.",
  },
  {
    value: "signOutOnGaming",
    title: "Выходить при входе в игры",
    text: "Между рабочими профилями сеанс остаётся, при переходе в игровой — выход из учётки.",
  },
];

/** Завершится ли сеанс профиля `from` при переходе в `to`. */
export function leaveSignsOut(from: Profile | null | undefined, to: Profile): boolean {
  if (!from) return false;
  return from.onLeave === "signOut" || (from.onLeave === "signOutOnGaming" && to.kind === "gaming");
}

export type AccountStatus = "current" | "loggedIn" | "linked" | "none";

const sameSid = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Состояние учётки профиля: текущая / вошла в фоне / только привязана / нет учётки. */
export function accountInfo(state: HubState, p: Profile): { status: AccountStatus; user: WinUserInfo | null } {
  if (!p.windowsUser) return { status: "none", user: null };
  const sid = p.windowsUser.sid;
  const user = state.windowsUsers.find((u) => sameSid(u.sid, sid)) ?? null;
  if (state.currentProfileId === p.id || sameSid(state.currentUser.sid, sid)) return { status: "current", user: user ?? state.currentUser };
  if (user?.loggedIn || state.runningProfiles.includes(p.id)) return { status: "loggedIn", user };
  return { status: "linked", user };
}

/** Профиль живёт в учётке текущего сеанса (например, игры — побочный режим основной учётки). */
export function sameAccount(p: Profile, state: HubState): boolean {
  return !!p.windowsUser && sameSid(p.windowsUser.sid, state.currentUser.sid);
}

/** Другой профиль, делящий с `p` одну учётку Windows. */
export function accountSibling(profiles: Profile[], p: Profile): Profile | null {
  if (!p.windowsUser) return null;
  return profileBySid(profiles, p.windowsUser.sid, p.id);
}

/**
 * Можно ли привязать профиль `me` к учётке `sid`. В одной учётке живут максимум один
 * рабочий и один игровой профиль. Возвращает профиль-владельца, мешающий привязке, или null.
 */
export function accountBlocker(profiles: Profile[], sid: string, me: Profile): Profile | null {
  return (
    profiles.find((p) => p.id !== me.id && !!p.windowsUser && sameSid(p.windowsUser.sid, sid) && p.kind === me.kind) ?? null
  );
}

/** Профиль, к которому привязана учётка с этим SID (кроме exceptId). */
export function profileBySid(profiles: Profile[], sid: string, exceptId?: string): Profile | null {
  return profiles.find((p) => p.id !== exceptId && !!p.windowsUser && sameSid(p.windowsUser.sid, sid)) ?? null;
}

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g",
};

export const USERNAME_MAX = 20;

/** Имя учётки из названия профиля: «Игры» → «Igry», «Работа — Финтех» → «Rabota-Fintekh». */
export function suggestUsername(name: string): string {
  let out = "";
  for (const ch of name.trim()) {
    const lower = ch.toLowerCase();
    const t = TRANSLIT[lower];
    if (t !== undefined) out += ch !== lower && t ? t[0].toUpperCase() + t.slice(1) : t;
    else if (/[A-Za-z0-9_-]/.test(ch)) out += ch;
    else out += "-";
  }
  out = out
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, USERNAME_MAX)
    .replace(/[-_]+$/, "");
  return out || "User";
}

const RESERVED_USERNAMES = ["administrator", "admin", "guest", "defaultaccount", "wdagutilityaccount", "system", "administrators", "users"];

/** Ошибка в имени учётки или null, если имя подходит. */
export function validateUsername(name: string, existing: WinUserInfo[]): string | null {
  if (!name) return "Введите имя";
  if (name.length > USERNAME_MAX) return `Не длиннее ${USERNAME_MAX} символов`;
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return "Только латинские буквы, цифры, «-» и «_»";
  if (!/[A-Za-z0-9]/.test(name)) return "Нужна хотя бы одна буква или цифра";
  if (RESERVED_USERNAMES.includes(name.toLowerCase())) return "Это имя зарезервировано Windows";
  if (existing.some((u) => u.username.toLowerCase() === name.toLowerCase()))
    return "Такая учётка уже есть — выберите её в «Выбрать существующую»";
  return null;
}

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
