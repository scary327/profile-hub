import { useCallback, useEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import { api, onBrowserUrl, type Bookmark, type Rect } from "../api";
import { FallbackImage } from "../components/FallbackImage";
import { hashColor } from "../lib/hash";
import type { PadAction } from "../lib/useGamepad";
import { Glyph, type InputDevice } from "./Glyph";

/*
 * Встроенный браузер игрового режима.
 *
 * Настоящая страница — нативный WebView, который бэкенд кладёт ПОВЕРХ окна ровно в прямоугольник
 * `.bp-view` (заглушка в DOM). Поэтому:
 *  - нативный вид показываем (browserOpen) только когда панель доехала до места, страница жива
 *    и поверх заглушки нет наших оверлеев (меню, экран запуска);
 *  - при любом из этих условий «нет» — browserHide (страница и звонок продолжают жить);
 *  - размеры/положение заглушки шлём через browserSetBounds (ResizeObserver + resize окна, через rAF).
 */

type Phase = "closed" | "opening" | "open" | "closing";

const SLIDE_MS = 420;

/** В dev-моке (обычный браузер) настоящего WebView нет — рисуем полосатую заглушку. */
export const IS_MOCK = typeof window !== "undefined" && !!(window as unknown as { __PH_MOCK__?: boolean }).__PH_MOCK__;

export interface BrowserCtl {
  phase: Phase;
  /** Панель на экране (в т.ч. въезжает/уезжает). */
  shown: boolean;
  /** Страница открыта (возможно, идёт звонок), даже если панель спрятана. */
  alive: boolean;
  url: string | null;
  expanded: boolean;
  viewRef: MutableRefObject<HTMLDivElement | null>;
  /** Показать панель; url — сразу перейти на адрес; null — последняя страница или «домашняя» с закладками. */
  show: (url?: string | null) => void;
  hide: () => void;
  toggle: () => void;
  /** Закрыть страницу совсем (звонок завершится). */
  close: () => void;
  navigate: (url: string) => void;
  setExpanded: (v: boolean) => void;
  onSlideEnd: () => void;
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

const sameRect = (a: Rect | null, b: Rect) =>
  !!a && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

const logErr = (what: string) => (e: unknown) => console.warn(`[browser] ${what}`, e);

/** Состояние панели и синхронизация с нативным WebView. `occluded` — поверх панели наш оверлей. */
export function useBrowserPanel(occluded: boolean): BrowserCtl {
  const [phase, setPhase] = useState<Phase>("closed");
  const [alive, setAlive] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const viewRef = useRef<HTMLDivElement | null>(null);
  /** Адрес, на который перейти при следующем показе нативного вида. */
  const pending = useRef<string | null>(null);
  /** Нативный вид сейчас показан. */
  const nativeShown = useRef(false);
  const lastRect = useRef<Rect | null>(null);

  const visible = phase === "open" && alive && !occluded;

  // показать / спрятать нативный вид
  useEffect(() => {
    const el = viewRef.current;
    if (visible && el && !nativeShown.current) {
      nativeShown.current = true;
      const r = rectOf(el);
      lastRect.current = r;
      const u = pending.current;
      pending.current = null;
      void api.browserOpen(u, r).catch(logErr("open"));
    } else if (!visible && nativeShown.current) {
      nativeShown.current = false;
      lastRect.current = null;
      void api.browserHide().catch(logErr("hide"));
    }
  }, [visible]);

  // следим за прямоугольником заглушки, пока нативный вид показан
  useEffect(() => {
    if (!visible) return;
    const el = viewRef.current;
    if (!el) return;
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!nativeShown.current) return;
        const r = rectOf(el);
        if (sameRect(lastRect.current, r)) return;
        lastRect.current = r;
        void api.browserSetBounds(r).catch(logErr("bounds"));
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
  }, [visible]);

  // адрес страницы от бэкенда
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

  // страховка: если animationend не пришёл (вкладка в фоне и т.п.)
  useEffect(() => {
    if (phase !== "opening" && phase !== "closing") return;
    const t = window.setTimeout(() => setPhase((p) => (p === "opening" ? "open" : p === "closing" ? "closed" : p)), SLIDE_MS + 250);
    return () => window.clearTimeout(t);
  }, [phase]);

  const onSlideEnd = useCallback(() => setPhase((p) => (p === "opening" ? "open" : p === "closing" ? "closed" : p)), []);

  const navigate = useCallback((u: string) => {
    setUrl(u);
    setAlive(true);
    if (nativeShown.current && viewRef.current) {
      void api.browserOpen(u, rectOf(viewRef.current)).catch(logErr("open"));
    } else {
      pending.current = u;
      setPhase((p) => (p === "closed" || p === "closing" ? "opening" : p));
    }
  }, []);

  const show = useCallback(
    (u?: string | null) => {
      if (u) navigate(u);
      else setPhase((p) => (p === "closed" || p === "closing" ? "opening" : p));
    },
    [navigate],
  );

  const hide = useCallback(() => setPhase((p) => (p === "open" || p === "opening" ? "closing" : p)), []);

  const toggle = useCallback(() => {
    setPhase((p) => (p === "open" || p === "opening" ? "closing" : "opening"));
  }, []);

  const close = useCallback(() => {
    // browserClose убирает и вид, и страницу — browserHide после него не нужен
    nativeShown.current = false;
    lastRect.current = null;
    pending.current = null;
    setAlive(false);
    setUrl(null);
    void api.browserClose().catch(logErr("close"));
  }, []);

  return {
    phase,
    shown: phase !== "closed",
    alive,
    url,
    expanded,
    viewRef,
    show,
    hide,
    toggle,
    close,
    navigate,
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
  search: <I d="M8.8 14.6a5.8 5.8 0 1 0 0-11.6 5.8 5.8 0 0 0 0 11.6zM13 13l4 4" />,
  globe: <I d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM3 10h14M10 3c2 2.2 2.8 4.6 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.6-2.8-7S8 5.2 10 3z" />,
};

// ---------- панель ----------

type CtlId = "back" | "forward" | "reload" | "star" | "expand" | "hide" | "close";

interface PanelProps {
  ctl: BrowserCtl;
  bookmarks: Bookmark[];
  onSaveBookmarks: (b: Bookmark[]) => void;
  device: InputDevice;
  /** Подсветка фокуса (управление геймпадом/клавиатурой). */
  showFocus: boolean;
  /** Сюда панель кладёт обработчик ввода геймпада, пока открыта. */
  padRef: MutableRefObject<((a: PadAction) => void) | null>;
}


type Ctl = { id: CtlId; label: string; icon: ReactNode; text?: string; danger?: boolean };
/** Строки фокуса геймпада: 0 — заголовок, 1 — навигация, 2 — закладки. */
type Row = 0 | 1 | 2;

export function BrowserPanel({ ctl, bookmarks, onSaveBookmarks, device, showFocus, padRef }: PanelProps) {
  const [draft, setDraft] = useState(ctl.url ?? "");
  const [editing, setEditing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [focus, setFocus] = useState<{ row: Row; idx: number }>({ row: 2, idx: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(ctl.url ?? "");
  }, [ctl.url, editing]);

  useEffect(() => {
    if (!confirmClose) return;
    const t = window.setTimeout(() => setConfirmClose(false), 3500);
    return () => window.clearTimeout(t);
  }, [confirmClose]);

  // при каждом открытии — фокус на закладки (домашняя) или на «Свернуть» (страница)
  const opening = ctl.phase === "opening";
  useEffect(() => {
    if (opening) setFocus(ctl.alive ? { row: 0, idx: 1 } : { row: 2, idx: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening]);

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
    ...(ctl.alive
      ? [{ id: "close" as const, label: "Закрыть страницу", icon: ICONS.hangup, text: confirmClose ? "Точно завершить?" : "Завершить", danger: true }]
      : []),
  ];
  const navCtls: Ctl[] = ctl.alive
    ? [
        { id: "back", label: "Назад", icon: ICONS.back },
        { id: "forward", label: "Вперёд", icon: ICONS.forward },
        { id: "reload", label: "Обновить", icon: ICONS.reload },
      ]
    : [];
  const starCtl: Ctl[] = ctl.alive
    ? [{ id: "star", label: starred ? "Убрать из закладок" : "Добавить в закладки", icon: starred ? ICONS.starOn : ICONS.starOff }]
    : [];
  const rows: Record<Row, number> = { 0: titleCtls.length, 1: navCtls.length + starCtl.length, 2: bookmarks.length };

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
    }
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
        if (cur.row === 0) run(titleCtls[cur.idx].id);
        else if (cur.row === 1) run([...navCtls, ...starCtl][cur.idx].id);
        else if (bookmarks[cur.idx]) ctl.navigate(bookmarks[cur.idx].url);
        break;
      case "back":
        ctl.hide();
        break;
      case "tabPrev":
        if (ctl.alive) void api.browserNav("back").catch(() => {});
        break;
      case "tabNext":
        if (ctl.alive) void api.browserNav("forward").catch(() => {});
        break;
      case "folder":
        inputRef.current?.focus();
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

  const cls = `bp bp--${ctl.phase}${ctl.expanded ? " bp--wide" : ""}`;
  return (
    <aside className={cls} onAnimationEnd={(e) => e.target === e.currentTarget && ctl.onSlideEnd()}>
      <div className="bp-titlebar">
        <div className="bp-title">
          {ctl.alive && current ? (
            <SiteIcon bm={{ name: hostOf(current), url: current }} className="site-icon--title" />
          ) : (
            <span className="bp-title__globe">{ICONS.globe}</span>
          )}
          <span className="bp-title__text">
            <span className="bp-title__name">{ctl.alive && current ? hostOf(current) : "Браузер"}</span>
            {ctl.alive && (
              <span className="bp-title__live">
                <span className="live-dot" />
                Свернёте панель — звонок продолжится
              </span>
            )}
          </span>
        </div>
        <div className="bp-group">{titleCtls.map((c, i) => renderCtl(c, 0, i))}</div>
      </div>

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

      {ctl.alive && bookmarks.length > 0 && (
        <nav className="bp-marks">
          {bookmarks.map((b, i) => (
            <button
              key={b.url}
              className={`bp-mark${current && normUrl(current) === normUrl(b.url) ? " is-current" : ""}${isF(2, i) ? " is-focused" : ""}`}
              onClick={() => ctl.navigate(b.url)}
              title={b.url}
            >
              <SiteIcon bm={b} />
              <span>{b.name}</span>
            </button>
          ))}
        </nav>
      )}

      <div className="bp-view" ref={ctl.viewRef}>
        {ctl.alive ? (
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
                <div className="bp-home__text">
                  Созвон в Meet, Telegram или Discord прямо в игровом режиме. Сверните панель — звонок продолжится.
                </div>
              </div>
            </div>
            {bookmarks.length > 0 ? (
              <>
                <div className="bp-home__label">Закладки</div>
                <div className="bp-home__grid">
                  {bookmarks.map((b, i) => (
                    <button key={b.url} className={`bp-site${isF(2, i) ? " is-focused" : ""}`} onClick={() => ctl.navigate(b.url)}>
                      <SiteIcon bm={b} className="site-icon--lg" />
                      <span className="bp-site__name">{b.name}</span>
                      <span className="bp-site__host">{hostOf(b.url)}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="bp-home__empty">Откройте сайт и нажмите ★, чтобы он появился здесь.</div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
