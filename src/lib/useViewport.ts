import { useEffect, useState } from "react";

/** Базовая единица интерфейса игрового режима: 1px макета 1920×1080, отмасштабированный под окно. */
function computeUnit(): { unit: number; width: number; height: number } {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return { unit: Math.min(height / 1080, width / 1920), width, height };
}

export function useViewportUnit() {
  const [v, setV] = useState(computeUnit);
  useEffect(() => {
    const onResize = () => setV(computeUnit());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return v;
}

/** Текущее время, обновляется в начале каждой минуты. */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t: number;
    const tick = () => {
      const d = new Date();
      setNow(d);
      t = window.setTimeout(tick, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50);
    };
    t = window.setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return now;
}
