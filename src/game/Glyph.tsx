import type { ReactNode } from "react";
import type { PadAction, PadType } from "../lib/useGamepad";

export type InputDevice = "keyboard" | PadType;

type GlyphAction = Exclude<PadAction, "up" | "down" | "left" | "right"> | "nav";

/*
 * Все значки — блоки фиксированного размера (--glyph, по умолчанию 32 единицы макета)
 * с содержимым, отцентрованным flex'ом. Символы PlayStation и «меню»/крестовина рисуются SVG
 * в общей сетке 20×20: у шрифтовых ✕ ○ △ ≡ разные базовые линии и размеры, и они «прыгали».
 * Буквы (A/B/Y, L1/R1, клавиши) — текст с обрезкой строки до высоты прописных (text-box),
 * поэтому центрируются по видимой части букв, а не по межстрочному интервалу.
 */

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 2.3, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg className="glyph__svg" viewBox="0 0 20 20" aria-hidden="true">
      {children}
    </svg>
  );
}

const SHAPES = {
  cross: (
    <Svg>
      <path d="M5.2 5.2l9.6 9.6M14.8 5.2l-9.6 9.6" {...STROKE} />
    </Svg>
  ),
  circle: (
    <Svg>
      <circle cx="10" cy="10" r="5.4" {...STROKE} />
    </Svg>
  ),
  // треугольник опущен на полпикселя: геометрический центр рамки выше «визуального» центра фигуры
  triangle: (
    <Svg>
      <path d="M10 4.6l5.9 10.1H4.1z" {...STROKE} />
    </Svg>
  ),
  menu: (
    <Svg>
      <path d="M5 6.2h10M5 10h10M5 13.8h10" {...STROKE} strokeWidth={2} />
    </Svg>
  ),
  dpad: (
    <Svg>
      <path
        d="M7.6 2.5h4.8v5.1h5.1v4.8h-5.1v5.1H7.6v-5.1H2.5V7.6h5.1z"
        fill="currentColor"
        fillOpacity="0.9"
        stroke="none"
      />
    </Svg>
  ),
  arrows: (
    <Svg>
      <path d="M10 2.8v14.4M2.8 10h14.4M7.6 5.2L10 2.8l2.4 2.4M7.6 14.8l2.4 2.4 2.4-2.4M5.2 7.6L2.8 10l2.4 2.4M14.8 7.6l2.4 2.4-2.4 2.4" {...STROKE} strokeWidth={1.7} />
    </Svg>
  ),
};

type Spec = { cls: string; content: ReactNode };

const text = (s: string) => <span className="glyph__text">{s}</span>;

const PS: Record<GlyphAction, Spec> = {
  confirm: { cls: "pad ps ps-cross", content: SHAPES.cross },
  back: { cls: "pad ps ps-circle", content: SHAPES.circle },
  folder: { cls: "pad ps ps-triangle", content: SHAPES.triangle },
  tabPrev: { cls: "shoulder", content: text("L1") },
  tabNext: { cls: "shoulder", content: text("R1") },
  menu: { cls: "shoulder shoulder--icon", content: SHAPES.menu },
  nav: { cls: "bare", content: SHAPES.dpad },
};

const XBOX: Record<GlyphAction, Spec> = {
  confirm: { cls: "pad xb xb-a", content: text("A") },
  back: { cls: "pad xb xb-b", content: text("B") },
  folder: { cls: "pad xb xb-y", content: text("Y") },
  tabPrev: { cls: "shoulder", content: text("LB") },
  tabNext: { cls: "shoulder", content: text("RB") },
  menu: { cls: "pad", content: SHAPES.menu },
  nav: { cls: "bare", content: SHAPES.dpad },
};

const KEYS: Record<GlyphAction, Spec> = {
  confirm: { cls: "key", content: text("Enter") },
  back: { cls: "key", content: text("Esc") },
  folder: { cls: "key", content: text("F") },
  tabPrev: { cls: "key", content: text("Q") },
  tabNext: { cls: "key", content: text("E") },
  menu: { cls: "key", content: text("Esc") },
  nav: { cls: "key key--icon", content: SHAPES.arrows },
};

/** Значок кнопки для текущего устройства ввода. */
export function Glyph({ action, device }: { action: GlyphAction; device: InputDevice }) {
  const g = (device === "keyboard" ? KEYS : device === "playstation" ? PS : XBOX)[action];
  const cls = g.cls
    .split(" ")
    .map((c) => `glyph--${c}`)
    .join(" ");
  return <span className={`glyph ${cls}`}>{g.content}</span>;
}
