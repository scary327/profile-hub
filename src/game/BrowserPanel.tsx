import { useCallback, useEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import { api, onBrowserUrl, onDockChanged, type Bookmark, type DockApp, type DockState, type Rect } from "../api";
import { FallbackImage } from "../components/FallbackImage";
import { errorMessage } from "../lib/errors";
import { hashColor } from "../lib/hash";
import type { PadAction } from "../lib/useGamepad";
import { Glyph, type InputDevice } from "./Glyph";

/*
 * Боковая панель игрового режима. Источник панели (source):
 *  - "web" — встроенный браузер: нативный WebView, который бэкенд кладёт ПОВЕРХ окна ровно в
 *    прямоугольник `.bp-view` (заглушка в DOM);
 *  - DockApp.id ("chrome", "discord", …) — настоящее окно приложения пользователя, которое бэкенд
 *    «пристыковывает» (без рамки, не в Alt+Tab) в тот же прямоугольник.
 * Правила одинаковые для обоих:
 *  - нативный вид показываем (browserOpen / dockOpen) только когда панель доехала до места,
 *    содержимое живо и поверх заглушки нет наших оверлеев (меню, экран запуска);
 *  - при любом «нет» — browserHide / dockHide (страница, приложение и звонок продолжают жить);
 *  - размеры заглушки шлём через browserSetBounds / dockSetBounds (ResizeObserver + resize окна, через rAF);
 *  - одновременно показан только один нативный вид.
 */

type Phase = "closed" | "opening" | "open" | "closing";
export type DockStatus = "idle" | "loading" | "ready" | "error";

export const WEB = "web";
const SLIDE_MS = 420;

/** В dev-моке (обычный браузер) настоящего WebView нет — рисуем полосатую заглушку. */
export const IS_MOCK = typeof window !== "undefined" && !!(window as unknown as { __PH_MOCK__?: boolean }).__PH_MOCK__;

export interface BrowserCtl {
  phase: Phase;
  /** Панель на экране (в т.ч. въезжает/уезжает). */
  shown: boolean;
  /** Что показывает панель: "web" или DockApp.id. */
  source: string;
  /** Страница встроенного браузера открыта (возможно, идёт звонок), даже если панель спрятана. */
  alive: boolean;
  url: string | null;
  /** Приложение, пристыкованное в панель (или стыкуемое прямо сейчас). */
  dockApp: string | null;
  /** Последнее состояние пристыкованного окна от бэкенда. */
  dock: DockState | null;
  dockStatus: DockStatus;
  dockError: string | null;
  expanded: boolean;
  viewRef: MutableRefObject<HTMLDivElement | null>;
  /** Показать панель с текущим источником; url — сразу открыть адрес во встроенном браузере. */
  show: (url?: string | null) => void;
  /** Показать панель с источником `source`; для приложений — пристыковать; url — открыть адрес (браузеры). */
  openIn: (source: string, url?: string | null) => void;
  hide: () => void;
  toggle: () => void;
  /** Закрыть страницу встроенного браузера совсем (звонок завершится). */
  close: () => void;
  navigate: (url: string) => void;
  /** Отстыковать приложение: окно вернётся на рабочий стол. */
  release: () => void;
  /** Повторить стыковку после ошибки. */
  retry: () => void;
  /** Окно игрового режима спрятано: бэкенд сам отстыковал окно, панель — закрыта. */
  reset: () => void;
  setExpanded: (v: boolean) => void;
  onSlideEnd: () => void;
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

const sameRect = (a: Rect | null, b: Rect) =>
  !!a && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

const logErr = (what: string) => (e: unknown) => console.warn(`[panel] ${what}`, e);

const isDockKey = (k: string | null) => !!k && k.startsWith("dock:");

/**
 * Состояние панели и синхронизация с нативными видами.
 * `occluded` — поверх панели наш оверлей; `defaultSource` — источник по умолчанию из настроек.
 */
export function useBrowserPanel(occluded: boolean, defaultSource: string): BrowserCtl {
  const [phase, setPhase] = useState<Phase>("closed");
  const [source, setSource] = useState<string>(defaultSource);
  const [alive, setAlive] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [dockApp, setDockApp] = useState<string | null>(null);
  const [dock, setDock] = useState<DockState | null>(null);
  const [dockStatus, setDockStatus] = useState<DockStatus>("idle");
  const [dockError, setDockError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const viewRef = useRef<HTMLDivElement | null>(null);

  /** Адрес для встроенного браузера при следующем показе. */
  const pendingWeb = useRef<string | null>(null);
  /** Адрес для пристыкованного браузера при следующем dockOpen. */
  const pendingDock = useRef<string | null>(null);
  /** Что сейчас показано нативно: "web" | "dock:<app>:<attempt>" | null. */
  const shownKey = useRef<string | null>(null);
  const lastRect = useRef<Rect | null>(null);
  const openSeq = useRef(0);
  const inflight = useRef(0);
  const dockRef = useRef<DockState | null>(null);
  dockRef.current = dock;
  const dockAppRef = useRef<string | null>(null);
  dockAppRef.current = dockApp;
  const statusRef = useRef<DockStatus>("idle");
  statusRef.current = dockStatus;

  // источник по умолчанию пришёл из настроек (или изменился), пока панель закрыта и ничего не пристыковано
  useEffect(() => {
    if (phase === "closed" && !dockAppRef.current) setSource(defaultSource);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSource]);

  const ready = phase === "open" && !occluded;
  const wantKey: string | null = !ready
    ? null
    : source === WEB
      ? alive
        ? "web"
        : null
      : dockApp === source
        ? `dock:${dockApp}:${attempt}`
        : null;

  /** dockOpen с учётом гонок: панель могли спрятать, пока приложение запускалось. */
  const openDock = useCallback((app: string, u: string | null, r: Rect, key: string) => {
    const seq = ++openSeq.current;
    inflight.current++;
    if (dockRef.current?.appId !== app || statusRef.current === "error") {
      setDockStatus("loading");
      setDockError(null);
    }
    api
      .dockOpen(app, u, r)
      .then((s) => {
        if (seq !== openSeq.current) return; // устарело — есть запрос новее
        setDock(s);
        setDockStatus("ready");
        if (shownKey.current !== key) {
          // пока запускалось, панель спрятали/переключили — окно не должно висеть поверх
          if (!isDockKey(shownKey.current)) void api.dockHide().catch(logErr("dock hide"));
          return;
        }
        const el = viewRef.current;
        if (el) {
          const nr = rectOf(el);
          if (!sameRect(r, nr)) {
            lastRect.current = nr;
            void api.dockSetBounds(nr).catch(logErr("dock bounds"));
          }
        }
        const p = pendingDock.current;
        if (p) {
          pendingDock.current = null;
          void api
            .dockOpen(app, p, lastRect.current ?? r)
            .then((s2) => setDock(s2))
            .catch(logErr("dock url"));
        }
      })
      .catch((e) => {
        if (seq !== openSeq.current) return;
        setDockStatus("error");
        setDockError(errorMessage(e));
      })
      .finally(() => {
        inflight.current--;
      });
  }, []);

  // показать / спрятать нативный вид (только один одновременно)
  useEffect(() => {
    const cur = shownKey.current;
    if (cur === wantKey) return;
    if (cur === "web") void api.browserHide().catch(logErr("web hide"));
    else if (isDockKey(cur) && !isDockKey(wantKey)) void api.dockHide().catch(logErr("dock hide"));
    shownKey.current = null;
    lastRect.current = null;
    const el = viewRef.current;
    if (!wantKey || !el) return;
    shownKey.current = wantKey;
    const r = rectOf(el);
    lastRect.current = r;
    if (wantKey === "web") {
      const u = pendingWeb.current;
      pendingWeb.current = null;
      void api.browserOpen(u, r).catch(logErr("web open"));
    } else {
      const app = wantKey.split(":")[1];
      const u = pendingDock.current;
      pendingDock.current = null;
      openDock(app, u, r, wantKey);
    }
  }, [wantKey, openDock]);

  // следим за прямоугольником заглушки, пока нативный вид показан
  useEffect(() => {
    if (!wantKey) return;
    const el = viewRef.current;
    if (!el) return;
    const isWeb = wantKey === "web";
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (shownKey.current !== wantKey) return;
        const r = rectOf(el);
        if (sameRect(lastRect.current, r)) return;
        lastRect.current = r;
        if (isWeb) void api.browserSetBounds(r).catch(logErr("web bounds"));
        // пока приложение запускается, прямоугольник досылается после dockOpen
        else if (statusRef.current === "ready") void api.dockSetBounds(r).catch(logErr("dock bounds"));
      });
    };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [wantKey]);

  // адрес страницы встроенного браузера от бэкенда
  useEffect(() => {
    let disposed = false;
    let un: (() => void) | undefined;
    onBrowserUrl((u) => !disposed && setUrl(u))
      .then((f) => (disposed ? f() : (un = f)))
      .catch(() => {});
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  // пристыкованное окно изменилось: закрылось само / отстыковано / сменился заголовок
  useEffect(() => {
    let disposed = false;
    let un: (() => void) | undefined;
    onDockChanged((s) => {
      if (disposed) return;
      if (s) {
        if (s.appId === dockAppRef.current) setDock(s);
        return;
      }
      // во время dockOpen бэкенд может отстыковать прежнее окно — это не про нас
      if (inflight.current > 0) return;
      if (isDockKey(shownKey.current)) {
        shownKey.current = null;
        lastRect.current = null;
      }
      setDockApp(null);
      setDock(null);
      setDockStatus("idle");
      setDockError(null);
    })
      .then((f) => (disposed ? f() : (un = f)))
      .catch(() => {});
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  // страховка: если animationend не пришёл (вкладка в фоне и т.п.)
  useEffect(() => {
    if (phase !== "opening" && phase !== "closing") return;
    const t = window.setTimeout(() => setPhase((p) => (p === "opening" ? "open" : p === "closing" ? "closed" : p)), SLIDE_MS + 250);
    return () => window.clearTimeout(t);
  }, [phase]);

  const onSlideEnd = useCallback(() => setPhase((p) => (p === "opening" ? "open" : p === "closing" ? "closed" : p)), []);
  const reveal = useCallback(() => setPhase((p) => (p === "closed" || p === "closing" ? "opening" : p)), []);

  const navigate = useCallback(
    (u: string) => {
      setSource(WEB);
      setUrl(u);
      setAlive(true);
      if (shownKey.current === "web" && viewRef.current) {
        void api.browserOpen(u, rectOf(viewRef.current)).catch(logErr("web open"));
      } else {
        pendingWeb.current = u;
        reveal();
      }
    },
    [reveal],
  );

  const openIn = useCallback(
    (src: string, u?: string | null) => {
      if (src === WEB) {
        setSource(WEB);
        if (u) navigate(u);
        else reveal();
        return;
      }
      setSource(src);
      setDockApp(src);
      const key = shownKey.current;
      if (u && key && key.startsWith(`dock:${src}:`) && statusRef.current === "ready" && viewRef.current) {
        // приложение уже в панели — просто открыть адрес в нём
        const r = rectOf(viewRef.current);
        void api
          .dockOpen(src, u, r)
          .then((s) => setDock(s))
          .catch(logErr("dock url"));
      } else if (u) pendingDock.current = u;
      reveal();
    },
    [navigate, reveal],
  );

  const show = useCallback(
    (u?: string | null) => {
      if (u) navigate(u);
      else reveal();
    },
    [navigate, reveal],
  );

  const hide = useCallback(() => setPhase((p) => (p === "open" || p === "opening" ? "closing" : p)), []);

  const toggle = useCallback(() => {
    setPhase((p) => (p === "open" || p === "opening" ? "closing" : "opening"));
  }, []);

  const close = useCallback(() => {
    // browserClose убирает и вид, и страницу — browserHide после него не нужен
    if (shownKey.current === "web") {
      shownKey.current = null;
      lastRect.current = null;
    }
    pendingWeb.current = null;
    setAlive(false);
    setUrl(null);
    void api.browserClose().catch(logErr("web close"));
  }, []);

  const release = useCallback(() => {
    // dockRelease сам убирает окно из панели — dockHide после него не нужен
    if (isDockKey(shownKey.current)) {
      shownKey.current = null;
      lastRect.current = null;
    }
    openSeq.current++;
    pendingDock.current = null;
    setDockApp(null);
    setDock(null);
    setDockStatus("idle");
    setDockError(null);
    void api.dockRelease().catch(logErr("dock release"));
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const reset = useCallback(() => {
    if (isDockKey(shownKey.current)) {
      shownKey.current = null;
      lastRect.current = null;
    }
    openSeq.current++;
    pendingDock.current = null;
    pendingWeb.current = null;
    setPhase("closed");
    setExpanded(false);
    setDockApp(null);
    setDock(null);
    setDockStatus("idle");
    setDockError(null);
    setSource(defaultSource);
  }, [defaultSource]);

  return {
    phase,
    shown: phase !== "closed",
    source,
    alive,
    url,
    dockApp,
    dock,
    // «готово» относится к прежнему приложению, пока новое не пристыковано
    dockStatus: dockStatus === "ready" && dockApp && dock?.appId !== dockApp ? "loading" : dockStatus,
    dockError,
    expanded,
    viewRef,
    show,
    openIn,
    hide,
    toggle,
    close,
    navigate,
    release,
    retry,
    reset,
    setExpanded,
    onSlideEnd,
  };
}

// ---------- адреса ----------

/** Адрес из строки ввода: похоже на URL — открываем, иначе ищем в Google. */
export function toUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|data|file):/i.test(s)) return s;
  if (!/\s/.test(s) && (/^localhost(:\d+)?(\/|$)/i.test(s) || /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(s)))
    return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const normUrl = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();

export const faviconOf = (url: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=64`;

/** Иконка сайта с запасной «буквой» в цвете от имени. */
export function SiteIcon({ bm, className }: { bm: Bookmark; className?: string }) {
  const letter = (bm.name.trim()[0] ?? hostOf(bm.url)[0] ?? "?").toUpperCase();
  return (
    <span className={`site-icon ${className ?? ""}`} style={{ "--site": hashColor(hostOf(bm.url)) } as CSSProperties}>
      <FallbackImage candidates={[faviconOf(bm.url)]} className="site-icon__img" fallback={<span className="site-icon__letter">{letter}</span>} />
    </span>
  );
}

// ---------- приложения ----------

/** Фирменный цвет и буква для значка приложения (без логотипов). */
const APP_SPEC: Record<string, { brand: string; letter: string }> = {
  chrome: { brand: "#4285f4", letter: "C" },
  edge: { brand: "#0c8ce9", letter: "E" },
  firefox: { brand: "#ff7139", letter: "F" },
  opera: { brand: "#ff1b2d", letter: "O" },
  operaGx: { brand: "#fa1e4e", letter: "GX" },
  brave: { brand: "#fb542b", letter: "B" },
  yandex: { brand: "#fc3f1d", letter: "Я" },
  discord: { brand: "#5865f2", letter: "D" },
  telegram: { brand: "#2aabee", letter: "T" },
  steamChat: { brand: "#1a9fff", letter: "S" },
};

export const appBrand = (id: string) => APP_SPEC[id]?.brand ?? hashColor(id);

/** «Google Chrome» → «Chrome», «Microsoft Edge» → «Edge». */
export const shortAppName = (name: string) => name.replace(/^(Google|Microsoft|Mozilla)\s+/i, "");

export function AppIcon({ id, className }: { id: string; className?: string }) {
  if (id === WEB)
    return (
      <span className={`app-icon app-icon--web ${className ?? ""}`}>
        <span className="app-icon__glyph">{ICONS.globe}</span>
      </span>
    );
  const s = APP_SPEC[id];
  const letter = s?.letter ?? id.slice(0, 1).toUpperCase();
  return (
    <span className={`app-icon ${className ?? ""}`} style={{ "--app": appBrand(id) } as CSSProperties}>
      <span className={`app-icon__letter${letter.length > 1 ? " is-small" : ""}`}>{letter}</span>
    </span>
  );
}

// ---------- иконки ----------

const I = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className="bp-ico">
    <path d={d} fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ICONS = {
  back: <I d="M12.5 4.5L7 10l5.5 5.5" />,
  forward: <I d="M7.5 4.5L13 10l-5.5 5.5" />,
  reload: <I d="M15.6 10a5.6 5.6 0 1 1-1.64-3.96M15.8 3.6v3.2h-3.2" />,
  starOff: <I d="M10 3.2l2.05 4.3 4.7.6-3.45 3.25.88 4.65L10 13.7 5.82 16l.88-4.65L3.25 8.1l4.7-.6z" />,
  starOn: <I fill d="M10 3.2l2.05 4.3 4.7.6-3.45 3.25.88 4.65L10 13.7 5.82 16l.88-4.65L3.25 8.1l4.7-.6z" />,
  expand: <I d="M11.5 3.8h4.7v4.7M8.5 16.2H3.8v-4.7M16.2 3.8l-5 5M3.8 16.2l5-5" />,
  shrink: <I d="M15.8 8.5h-4.3V4.2M4.2 11.5h4.3v4.3M11.5 8.5l4.7-4.7M8.5 11.5l-4.7 4.7" />,
  hide: <I d="M4.5 10h11M11 5.5l4.5 4.5-4.5 4.5" />,
  hangup: (
    <I d="M2.9 11.6c4.1-3.6 10.1-3.6 14.2 0l-1.3 2.1a1 1 0 0 1-1.25.4l-2.1-.9a1 1 0 0 1-.6-.95v-1.4a7.7 7.7 0 0 0-3.7 0v1.4a1 1 0 0 1-.6.95l-2.1.9a1 1 0 0 1-1.25-.4z" />
  ),
  detach: <I d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3M11 3.8h5.2V9M16 4l-7 7" />,
  search: <I d="M8.8 14.6a5.8 5.8 0 1 0 0-11.6 5.8 5.8 0 0 0 0 11.6zM13 13l4 4" />,
  globe: <I d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM3 10h14M10 3c2 2.2 2.8 4.6 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.6-2.8-7S8 5.2 10 3z" />,
  retry: <I d="M15.6 10a5.6 5.6 0 1 1-1.64-3.96M15.8 3.6v3.2h-3.2" />,
  dock: <I d="M3.5 5.5a1.5 1.5 0 0 1 1.5-1.5h10a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5zM11.5 4v12" />,
};

// ---------- панель ----------

type CtlId = "back" | "forward" | "reload" | "star" | "expand" | "hide" | "close" | "release";

interface PanelProps {
  ctl: BrowserCtl;
  /** Установленные приложения, которые можно пристыковать. */
  apps: DockApp[];
  bookmarks: Bookmark[];
  onSaveBookmarks: (b: Bookmark[]) => void;
  /** Пользователь выбрал источник в переключателе (браузеры запоминаются по умолчанию). */
  onPickSource: (id: string) => void;
  device: InputDevice;
  /** Подсветка фокуса (управление геймпадом/клавиатурой). */
  showFocus: boolean;
  /** Сюда панель кладёт обработчик ввода геймпада, пока открыта. */
  padRef: MutableRefObject<((a: PadAction) => void) | null>;
}

type Ctl = { id: CtlId; label: string; icon: ReactNode; text?: string; danger?: boolean };
/** Элементы строки 2: кнопка «открыть приложение», «повторить» или закладка. */
type Item = { key: string; kind: "cta" | "retry" | "bm"; bm?: Bookmark };
/** Строки фокуса геймпада: 0 — заголовок (источники + кнопки), 1 — навигация, 2 — закладки/действия. */
type Row = 0 | 1 | 2;

export function BrowserPanel({ ctl, apps, bookmarks, onSaveBookmarks, onPickSource, device, showFocus, padRef }: PanelProps) {
  const [draft, setDraft] = useState(ctl.url ?? "");
  const [editing, setEditing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [focus, setFocus] = useState<{ row: Row; idx: number }>({ row: 2, idx: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  const isWeb = ctl.source === WEB;
  const app = isWeb ? null : (apps.find((a) => a.id === ctl.source) ?? null);
  const appName = app ? shortAppName(app.name) : ctl.source;
  const isBrowserApp = !isWeb && (app?.kind ?? "browser") === "browser";
  const docked = !isWeb && ctl.dockApp === ctl.source;
  /** Содержимое живо (страница или пристыкованное окно). */
  const live = isWeb ? ctl.alive : docked;

  useEffect(() => {
    if (!editing) setDraft(ctl.url ?? "");
  }, [ctl.url, editing]);

  useEffect(() => {
    if (!confirmClose) return;
    const t = window.setTimeout(() => setConfirmClose(false), 3500);
    return () => window.clearTimeout(t);
  }, [confirmClose]);

  const sources: Array<{ id: string; name: string; kind: "web" | "browser" | "voice" }> = [
    { id: WEB, name: "Встроенный", kind: "web" },
    ...apps.filter((a) => a.installed && a.kind === "browser").map((a) => ({ id: a.id, name: shortAppName(a.name), kind: "browser" as const })),
    ...apps.filter((a) => a.installed && a.kind === "voice").map((a) => ({ id: a.id, name: a.name, kind: "voice" as const })),
  ];
  // источник, которого нет в списке (список ещё грузится) — всё равно показываем
  if (!sources.some((s) => s.id === ctl.source)) sources.push({ id: ctl.source, name: appName, kind: "browser" });

  const current = ctl.url;
  const starred = !!current && bookmarks.some((b) => normUrl(b.url) === normUrl(current));

  const toggleStar = () => {
    if (!current) return;
    if (starred) onSaveBookmarks(bookmarks.filter((b) => normUrl(b.url) !== normUrl(current)));
    else {
      const h = hostOf(current);
      const name = h.split(".").slice(-2, -1)[0] ?? h;
      onSaveBookmarks([...bookmarks, { name: name.charAt(0).toUpperCase() + name.slice(1), url: current }]);
    }
  };

  const titleCtls: Ctl[] = [
    { id: "expand", label: ctl.expanded ? "Сузить панель" : "Развернуть панель", icon: ctl.expanded ? ICONS.shrink : ICONS.expand },
    { id: "hide", label: "Свернуть (звонок продолжится)", icon: ICONS.hide, text: "Свернуть" },
    ...(isWeb && ctl.alive
      ? [{ id: "close" as const, label: "Закрыть страницу", icon: ICONS.hangup, text: confirmClose ? "Точно завершить?" : "Завершить", danger: true }]
      : []),
    ...(docked ? [{ id: "release" as const, label: `Вернуть окно ${appName} на рабочий стол`, icon: ICONS.detach, text: "Отсоединить" }] : []),
  ];
  const navCtls: Ctl[] =
    isWeb && ctl.alive
      ? [
          { id: "back", label: "Назад", icon: ICONS.back },
          { id: "forward", label: "Вперёд", icon: ICONS.forward },
          { id: "reload", label: "Обновить", icon: ICONS.reload },
        ]
      : [];
  const starCtl: Ctl[] =
    isWeb && ctl.alive ? [{ id: "star", label: starred ? "Убрать из закладок" : "Добавить в закладки", icon: starred ? ICONS.starOn : ICONS.starOff }] : [];
  const bmItems: Item[] = bookmarks.map((b) => ({ key: `bm:${b.url}`, kind: "bm", bm: b }));
  const items: Item[] = isWeb
    ? bmItems
    : [
        ...(docked && ctl.dockStatus === "error" ? [{ key: "retry", kind: "retry" as const }] : []),
        ...(!docked ? [{ key: "cta", kind: "cta" as const }] : []),
        ...(isBrowserApp ? bmItems : []),
      ];
  const row0 = sources.length + titleCtls.length;
  const rows: Record<Row, number> = { 0: row0, 1: isWeb ? navCtls.length + starCtl.length : 0, 2: items.length };

  // при каждом открытии — фокус на закладки (домашняя) или на «Свернуть» (страница/окно)
  const opening = ctl.phase === "opening";
  useEffect(() => {
    if (opening) setFocus(live ? { row: 0, idx: sources.length + 1 } : { row: 2, idx: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening]);

  const openBookmark = (u: string) => {
    if (isWeb) ctl.navigate(u);
    else ctl.openIn(ctl.source, u);
  };

  const pickSource = (id: string) => {
    if (id === ctl.source && (id === WEB || docked)) return;
    onPickSource(id);
  };

  const run = (id: CtlId) => {
    switch (id) {
      case "back":
      case "forward":
      case "reload":
        void api.browserNav(id).catch(() => {});
        break;
      case "star":
        toggleStar();
        break;
      case "expand":
        ctl.setExpanded(!ctl.expanded);
        break;
      case "hide":
        ctl.hide();
        break;
      case "close":
        if (confirmClose) {
          setConfirmClose(false);
          ctl.close();
        } else setConfirmClose(true);
        break;
      case "release":
        ctl.release();
        setFocus({ row: 2, idx: 0 });
        break;
    }
  };

  const runItem = (it: Item) => {
    if (it.kind === "bm" && it.bm) openBookmark(it.bm.url);
    else if (it.kind === "retry") ctl.retry();
    else if (it.kind === "cta") ctl.openIn(ctl.source, null);
  };

  const submit = () => {
    const u = toUrl(draft);
    if (!u) return;
    setEditing(false);
    inputRef.current?.blur();
    ctl.navigate(u);
  };

  // строка/индекс фокуса с поправкой на пустые строки
  const norm = (f: { row: Row; idx: number }): { row: Row; idx: number } => {
    let row = f.row;
    if (!rows[row]) row = ([2, 1, 0] as Row[]).find((r) => rows[r]) ?? 0;
    return { row, idx: Math.max(0, Math.min(rows[row] - 1, f.idx)) };
  };
  const cur = norm(focus);

  // ввод геймпада, пока панель открыта
  const pad = (a: PadAction) => {
    const step = (dir: 1 | -1): Row | null => {
      for (let r = cur.row + dir; r >= 0 && r <= 2; r += dir) if (rows[r as Row]) return r as Row;
      return null;
    };
    switch (a) {
      case "left":
        setFocus({ ...cur, idx: Math.max(0, cur.idx - 1) });
        break;
      case "right":
        setFocus({ ...cur, idx: Math.min(rows[cur.row] - 1, cur.idx + 1) });
        break;
      case "up":
      case "down": {
        const r = step(a === "up" ? -1 : 1);
        if (r !== null) setFocus({ row: r, idx: Math.min(cur.idx, rows[r] - 1) });
        break;
      }
      case "confirm":
        if (cur.row === 0) {
          if (cur.idx < sources.length) pickSource(sources[cur.idx].id);
          else run(titleCtls[cur.idx - sources.length].id);
        } else if (cur.row === 1) run([...navCtls, ...starCtl][cur.idx].id);
        else if (items[cur.idx]) runItem(items[cur.idx]);
        break;
      case "back":
        ctl.hide();
        break;
      case "tabPrev":
        if (isWeb && ctl.alive) void api.browserNav("back").catch(() => {});
        break;
      case "tabNext":
        if (isWeb && ctl.alive) void api.browserNav("forward").catch(() => {});
        break;
      case "folder":
        if (isWeb) inputRef.current?.focus();
        break;
    }
  };
  padRef.current = pad;
  useEffect(
    () => () => {
      padRef.current = null;
    },
    [padRef],
  );

  const isF = (row: Row, idx: number) => showFocus && cur.row === row && cur.idx === idx;
  const itemIdx = (key: string) => items.findIndex((it) => it.key === key);

  const renderCtl = (c: Ctl, row: Row, idx: number) => (
    <button
      key={c.id}
      className={`bp-btn${c.text ? " bp-btn--text" : ""}${c.danger ? " bp-btn--danger" : ""}${c.id === "star" && starred ? " is-on" : ""}${confirmClose && c.id === "close" ? " is-armed" : ""}${isF(row, idx) ? " is-focused" : ""}`}
      title={c.label}
      aria-label={c.label}
      onClick={() => run(c.id)}
    >
      {c.icon}
      {c.text && <span>{c.text}</span>}
    </button>
  );

  const renderMarks = () =>
    bookmarks.length > 0 && (
      <nav className="bp-marks">
        {bookmarks.map((b) => {
          const i = itemIdx(`bm:${b.url}`);
          return (
            <button
              key={b.url}
              className={`bp-mark${isWeb && current && normUrl(current) === normUrl(b.url) ? " is-current" : ""}${isF(2, i) ? " is-focused" : ""}`}
              onClick={() => openBookmark(b.url)}
              title={isWeb ? b.url : `Открыть в ${appName}: ${b.url}`}
            >
              <SiteIcon bm={b} />
              <span>{b.name}</span>
            </button>
          );
        })}
      </nav>
    );

  const renderGrid = () => (
    <div className="bp-home__grid">
      {bookmarks.map((b) => {
        const i = itemIdx(`bm:${b.url}`);
        return (
          <button key={b.url} className={`bp-site${isF(2, i) ? " is-focused" : ""}`} onClick={() => openBookmark(b.url)}>
            <SiteIcon bm={b} className="site-icon--lg" />
            <span className="bp-site__name">{b.name}</span>
            <span className="bp-site__host">{hostOf(b.url)}</span>
          </button>
        );
      })}
    </div>
  );

  // ---------- содержимое области вида ----------
  let view: ReactNode;
  if (isWeb) {
    view = ctl.alive ? (
      IS_MOCK ? (
        <div className="bp-mock">
          <div className="bp-mock__badge">WebView</div>
          <div className="bp-mock__url">{current}</div>
          <div className="bp-mock__note">Здесь бэкенд разместит настоящую страницу</div>
        </div>
      ) : (
        <div className="bp-loading">
          <span className="bp-spinner" />
        </div>
      )
    ) : (
      <div className="bp-home">
        <div className="bp-home__hero">
          <span className="bp-home__globe">{ICONS.globe}</span>
          <div>
            <div className="bp-home__title">Голос в браузере</div>
            <div className="bp-home__text">Созвон в Meet, Telegram или Discord прямо в игровом режиме. Сверните панель — звонок продолжится.</div>
          </div>
        </div>
        {bookmarks.length > 0 ? (
          <>
            <div className="bp-home__label">Закладки</div>
            {renderGrid()}
          </>
        ) : (
          <div className="bp-home__empty">Откройте сайт и нажмите ★, чтобы он появился здесь.</div>
        )}
      </div>
    );
  } else if (!docked) {
    const ctaI = itemIdx("cta");
    view = (
      <div className="bp-home">
        <div className="bp-home__hero">
          <AppIcon id={ctl.source} className="app-icon--hero" />
          <div>
            <div className="bp-home__title">{appName} в панели</div>
            <div className="bp-home__text">
              {isBrowserApp
                ? `Ваш ${appName} со всеми входами и вкладками — прямо в игровом режиме, без Alt+Tab.`
                : `Окно ${appName} откроется здесь, без Alt+Tab. Сверните панель — звонок продолжится.`}
            </div>
          </div>
        </div>
        <button className={`bp-cta${isF(2, ctaI) ? " is-focused" : ""}`} style={{ "--app": appBrand(ctl.source) } as CSSProperties} onClick={() => ctl.openIn(ctl.source, null)}>
          {ICONS.dock}
          <span>Открыть {appName} здесь</span>
        </button>
        {isBrowserApp && bookmarks.length > 0 && (
          <>
            <div className="bp-home__label bp-home__label--gap">Закладки — откроются в {appName}</div>
            {renderGrid()}
          </>
        )}
      </div>
    );
  } else if (ctl.dockStatus === "error") {
    const ri = itemIdx("retry");
    view = (
      <div className="bp-dockstate bp-dockstate--error">
        <AppIcon id={ctl.source} className="app-icon--hero" />
        <div className="bp-dockstate__title">Не удалось открыть {appName}</div>
        <div className="bp-dockstate__text">{ctl.dockError}</div>
        <button className={`bp-cta${isF(2, ri) ? " is-focused" : ""}`} style={{ "--app": appBrand(ctl.source) } as CSSProperties} onClick={() => ctl.retry()}>
          {ICONS.retry}
          <span>Повторить</span>
        </button>
      </div>
    );
  } else if (ctl.dockStatus === "ready" && IS_MOCK) {
    view = (
      <div className="bp-mock" style={{ "--app": appBrand(ctl.source) } as CSSProperties}>
        <div className="bp-mock__badge">Окно {appName}</div>
        <div className="bp-mock__url">{ctl.dock?.title}</div>
        <div className="bp-mock__note">Здесь бэкенд разместит настоящее окно приложения</div>
      </div>
    );
  } else if (ctl.dockStatus === "ready") {
    view = <div className="bp-loading" />;
  } else {
    view = (
      <div className="bp-dockstate">
        <span className="bp-dockstate__ring" style={{ "--app": appBrand(ctl.source) } as CSSProperties}>
          <AppIcon id={ctl.source} className="app-icon--hero" />
        </span>
        <div className="bp-dockstate__title">Запускаем {appName}…</div>
        <div className="bp-dockstate__text">Окно появится прямо здесь — без Alt+Tab</div>
      </div>
    );
  }

  const cls = `bp bp--${ctl.phase}${ctl.expanded ? " bp--wide" : ""}`;
  return (
    <aside className={cls} onAnimationEnd={(e) => e.target === e.currentTarget && ctl.onSlideEnd()}>
      <div className="bp-titlebar">
        <div className="bp-sources" role="tablist" aria-label="Что показать в панели">
          {sources.map((s, i) => {
            const on = s.id === ctl.source;
            const isLive = s.id === WEB ? ctl.alive : ctl.dockApp === s.id;
            const prevKind = i > 0 ? sources[i - 1].kind : s.kind;
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={on}
                className={`bp-src${on ? " is-on" : ""}${isF(0, i) ? " is-focused" : ""}${prevKind !== s.kind && s.kind === "voice" ? " bp-src--sep" : ""}`}
                style={{ "--app": s.id === WEB ? "var(--glow)" : appBrand(s.id) } as CSSProperties}
                title={s.id === WEB ? "Встроенный браузер" : s.name}
                onClick={() => pickSource(s.id)}
              >
                <AppIcon id={s.id} />
                {on && <span className="bp-src__name">{s.name}</span>}
                {isLive && <span className="live-dot bp-src__live" />}
              </button>
            );
          })}
        </div>
        <div className="bp-group">{titleCtls.map((c, i) => renderCtl(c, 0, sources.length + i))}</div>
      </div>

      {isWeb ? (
        <header className="bp-head">
          {navCtls.length > 0 && <div className="bp-group">{navCtls.map((c, i) => renderCtl(c, 1, i))}</div>}
          <label className={`bp-url${editing ? " is-editing" : ""}`}>
            <span className="bp-url__icon">{ICONS.search}</span>
            <input
              ref={inputRef}
              value={draft}
              spellCheck={false}
              placeholder="Адрес сайта или поиск в Google"
              onFocus={(e) => {
                setEditing(true);
                e.currentTarget.select();
              }}
              onBlur={() => setEditing(false)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft(ctl.url ?? "");
                  e.currentTarget.blur();
                }
              }}
            />
            {!editing && <Glyph action="folder" device={device} />}
          </label>
          {starCtl.map((c) => renderCtl(c, 1, navCtls.length))}
        </header>
      ) : (
        docked && (
          <header className="bp-head bp-dockinfo">
            <AppIcon id={ctl.source} className="app-icon--title" />
            <span className="bp-title__text">
              <span className="bp-title__name">
                {appName}
                {ctl.dock?.title && ctl.dock.title !== appName && ctl.dockStatus === "ready" && <span className="bp-dockinfo__win"> · {ctl.dock.title}</span>}
              </span>
              <span className="bp-title__live">
                {ctl.dockStatus === "ready" ? (
                  <>
                    <span className="live-dot" />
                    Свернёте панель — {isBrowserApp ? "вкладки и звонки продолжатся" : "звонок продолжится"}
                  </>
                ) : ctl.dockStatus === "error" ? (
                  "Окно не пристыковано"
                ) : (
                  "Ищем окно приложения…"
                )}
              </span>
            </span>
          </header>
        )
      )}

      {((isWeb && ctl.alive) || (docked && isBrowserApp)) && renderMarks()}

      <div className="bp-view" ref={ctl.viewRef}>
        {view}
      </div>
    </aside>
  );
}
