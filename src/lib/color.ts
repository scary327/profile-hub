export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [124, 92, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** "#RRGGBB" → "r g b" для использования в rgb(var(--x) / a). */
export function hexToRgbTriplet(hex: string): string {
  return hexToRgb(hex).join(" ");
}

export function isHexColor(s: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(s);
}

export function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

function rgbToHsl(r255: number, g255: number, b255: number): [number, number, number] {
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

/** Делает цвет пригодным для свечения: поднимает насыщенность и держит яркость в рамках. */
export function vividize(hex: string): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  return hslToHex(h, Math.max(s, 55), Math.min(Math.max(l, 50), 62));
}

const avgCache = new Map<string, Promise<string>>();

/**
 * Средний цвет картинки (по уменьшенной копии на canvas).
 * Если canvas «испорчен» CORS-ом или картинка не грузится — возвращает `fallback`.
 */
export function averageImageColor(src: string, fallback: string): Promise<string> {
  const cached = avgCache.get(src);
  if (cached) return cached;
  const p = new Promise<string>((resolve) => {
    const fail = () => resolve(fallback);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return fail();
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let w = 0;
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i];
          const pg = data[i + 1];
          const pb = data[i + 2];
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          // насыщенные пиксели весят больше — средний цвет не уходит в серость
          const weight = 0.1 + (max - min) / 255 + (max > 40 ? 0.15 : 0);
          r += pr * weight;
          g += pg * weight;
          b += pb * weight;
          w += weight;
        }
        if (w === 0) return fail();
        resolve(vividize(rgbToHex(r / w, g / w, b / w)));
      } catch {
        // canvas tainted (нет CORS) — используем запасной цвет
        fail();
      }
    };
    img.onerror = fail;
    img.src = src;
  });
  avgCache.set(src, p);
  return p;
}
