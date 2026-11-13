import { hslToHex } from "./color";

/** Детерминированный 32-битный хэш строки (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Оттенок 0..359 из строки. */
export function hashHue(s: string): number {
  return hashString(s) % 360;
}

/** Насыщенный цвет из строки, "#RRGGBB". */
export function hashColor(s: string): string {
  return hslToHex(hashHue(s), 62, 55);
}

/** CSS-градиент для сгенерированной плитки. */
export function hashGradient(s: string): string {
  const h = hashHue(s);
  const h2 = (h + 40 + (hashString(s + "#") % 60)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 42%) 0%, hsl(${h2} 65% 20%) 100%)`;
}

/** Инициалы: «Counter-Strike 2» → «CS», «Dota 2» → «D2». */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
