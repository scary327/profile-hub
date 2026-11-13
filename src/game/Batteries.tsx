import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DeviceBattery } from "../api";

/*
 * Заряд беспроводных устройств в верхней панели игрового режима:
 * геймпад — рядом со значком геймпада (PadBattery), остальное — компактные значки (Batteries).
 */

const LOW = 15;
const WARN = 30;

const level = (p: number) => (p <= LOW ? " is-low" : p <= WARN ? " is-warn" : "");

/** Батарейка с заливкой по уровню и молнией при зарядке. */
function BatteryIcon({ percent, charging }: { percent: number; charging?: boolean }) {
  const w = Math.max(1.5, Math.min(100, percent) * 0.14);
  return (
    <svg viewBox="0 0 24 14" className="gm-batt__icon" aria-hidden="true">
      <rect x="0.9" y="0.9" width="19.2" height="12.2" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.7" />
      <rect x="21.2" y="4.6" width="2" height="4.8" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="3.5" y="3.5" width={w} height="7" rx="1.4" fill="currentColor" />
      {charging && <path d="M11.8 1.8L7.6 7.6h3.2l-1 4.6 4.4-6h-3.3z" fill="#fff" stroke="rgb(0 0 0 / 0.55)" strokeWidth="0.8" strokeLinejoin="round" />}
    </svg>
  );
}

export function PadBattery({ percent, charging }: { percent: number | null; charging: boolean }) {
  if (percent === null) return null;
  const p = Math.round(percent);
  return (
    <span className={`gm-batt${level(p)}${charging ? " is-charging" : ""}`} title={`Геймпад: ${p}%${charging ? ", заряжается" : ""}`}>
      <BatteryIcon percent={p} charging={charging} />
      <span className="gm-batt__pct">{p}%</span>
    </span>
  );
}

const DI = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" className="gm-dev__glyph" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const KIND_ICON: Record<DeviceBattery["kind"], ReactNode> = {
  headset: (
    <DI>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z" />
    </DI>
  ),
  mouse: (
    <DI>
      <rect x="6" y="3" width="12" height="18" rx="6" />
      <path d="M12 7v3" />
    </DI>
  ),
  keyboard: (
    <DI>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8" />
    </DI>
  ),
  gamepad: (
    <DI>
      <path d="M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-4 3.6l-.6 6A3 3 0 0 0 5.1 18c1.4 0 2-.9 2.9-2l.6-.8a2 2 0 0 1 1.6-.7h3.6a2 2 0 0 1 1.6.7l.6.8c.9 1.1 1.5 2 2.9 2a3 3 0 0 0 3-3.4l-.6-6A4 4 0 0 0 17.3 5z" />
    </DI>
  ),
  other: (
    <DI>
      <path d="M7 7l10 10-5 4V3l5 4L7 17" />
    </DI>
  ),
};

const KIND_LABEL: Record<DeviceBattery["kind"], string> = {
  headset: "Наушники",
  mouse: "Мышь",
  keyboard: "Клавиатура",
  gamepad: "Геймпад",
  other: "Устройство",
};

function Device({ d, wide }: { d: DeviceBattery; wide?: boolean }) {
  const p = Math.round(d.percent);
  return (
    <span className={`gm-dev${level(p)}${wide ? " gm-dev--row" : ""}`} title={`${d.name}: ${p}%`}>
      {KIND_ICON[d.kind] ?? KIND_ICON.other}
      {wide && <span className="gm-dev__name">{d.name || KIND_LABEL[d.kind]}</span>}
      <span className="gm-dev__pct">{p}%</span>
    </span>
  );
}

const MAX_INLINE = 2;

/** Устройства с батареей: до двух значков, остальное — «+N» с выпадающим списком. */
export function Batteries({ items }: { items: DeviceBattery[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // разряженные — первыми
  const list = [...items].sort((a, b) => a.percent - b.percent);
  const extra = list.length > MAX_INLINE ? list.length - MAX_INLINE : 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (!extra) setOpen(false);
  }, [extra]);

  if (!list.length) return null;
  return (
    <div className="gm-devs" ref={ref}>
      {list.slice(0, MAX_INLINE).map((d, i) => (
        <Device key={`${d.name}:${i}`} d={d} />
      ))}
      {extra > 0 && (
        <button className={`gm-devs__more${open ? " is-open" : ""}`} onClick={() => setOpen((o) => !o)} title="Все устройства">
          +{extra}
        </button>
      )}
      {open && (
        <div className="gm-devs__pop" role="dialog" aria-label="Заряд устройств">
          <div className="gm-devs__title">Заряд устройств</div>
          {list.map((d, i) => (
            <Device key={`${d.name}:${i}`} d={d} wide />
          ))}
        </div>
      )}
    </div>
  );
}
