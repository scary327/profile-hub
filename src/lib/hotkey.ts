const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "OS", "AltGraph"]);

export interface HotkeyParse {
  /** Готовая строка, если нажата основная клавиша. */
  combo: string | null;
  /** Что показать, пока сочетание не дожато («Ctrl+Alt+…»). */
  preview: string;
}

const CODE_MAP: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
  Delete: "Delete",
  Backspace: "Backspace",
  Pause: "Pause",
  PrintScreen: "PrintScreen",
  NumpadAdd: "NumpadAdd",
  NumpadSubtract: "NumpadSubtract",
  NumpadMultiply: "NumpadMultiply",
  NumpadDivide: "NumpadDivide",
};

function mainKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (/^Numpad[0-9]$/.test(code)) return code;
  return CODE_MAP[code] ?? null;
}

/** Строит строку вида "Ctrl+Alt+1" из события клавиатуры (по физической клавише, раскладка не важна). */
export function parseHotkey(e: KeyboardEvent): HotkeyParse {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  const preview = mods.length ? mods.join(" + ") + " + …" : "";
  if (MODIFIER_KEYS.has(e.key)) return { combo: null, preview };
  const key = mainKey(e.code);
  if (!key) return { combo: null, preview };
  const isF = /^F\d+$/.test(key);
  // без модификатора разрешаем только F-клавиши, иначе хоткей сломает обычный ввод
  if (mods.length === 0 && !isF) return { combo: null, preview: "Нужен модификатор: Ctrl, Alt, Shift или Win" };
  return { combo: [...mods, key].join("+"), preview: "" };
}

/** "Ctrl+Alt+1" → ["Ctrl", "Alt", "1"]; "Super" показываем как «Win». */
export function hotkeyParts(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split("+")
    .filter(Boolean)
    .map((p) => (p === "Super" ? "Win" : p));
}
