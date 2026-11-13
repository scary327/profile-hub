import type { PadAction, PadType } from "../lib/useGamepad";

export type InputDevice = "keyboard" | PadType;

type GlyphAction = Exclude<PadAction, "up" | "down" | "left" | "right"> | "nav";

const PS: Record<GlyphAction, { label: string; cls: string }> = {
  confirm: { label: "✕", cls: "ps-cross" },
  back: { label: "○", cls: "ps-circle" },
  folder: { label: "△", cls: "ps-triangle" },
  tabPrev: { label: "L1", cls: "shoulder" },
  tabNext: { label: "R1", cls: "shoulder" },
  menu: { label: "≡", cls: "ps-options" },
  nav: { label: "✥", cls: "dpad" },
};

const XBOX: Record<GlyphAction, { label: string; cls: string }> = {
  confirm: { label: "A", cls: "xb-a" },
  back: { label: "B", cls: "xb-b" },
  folder: { label: "Y", cls: "xb-y" },
  tabPrev: { label: "LB", cls: "shoulder" },
  tabNext: { label: "RB", cls: "shoulder" },
  menu: { label: "☰", cls: "xb-menu" },
  nav: { label: "✥", cls: "dpad" },
};

const KEYS: Record<GlyphAction, string> = {
  confirm: "Enter",
  back: "Esc",
  folder: "F",
  tabPrev: "Q",
  tabNext: "E",
  menu: "Esc",
  nav: "←→↑↓",
};

/** Значок кнопки для текущего устройства ввода. */
export function Glyph({ action, device }: { action: GlyphAction; device: InputDevice }) {
  if (device === "keyboard") return <span className="glyph glyph--key">{KEYS[action]}</span>;
  const g = (device === "playstation" ? PS : XBOX)[action];
  return <span className={`glyph glyph--pad glyph--${g.cls}`}>{g.label}</span>;
}
