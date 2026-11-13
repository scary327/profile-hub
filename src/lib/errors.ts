/** Ошибки invoke приходят строками; на всякий случай поддерживаем и Error. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Цель события — поле ввода (тогда глобальные хоткеи хаба не срабатывают). */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (t as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "color", "range", "submit"].includes(type);
  }
  return t.dataset.hotkeyRecorder === "true";
}
