import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api, type Game, type GameSource, type LauncherInfo } from "../api";
import { FallbackImage } from "../components/FallbackImage";
import { ToastProvider, useToast } from "../components/Toasts";
import { averageImageColor, hexToRgbTriplet } from "../lib/color";
import { isTypingTarget } from "../lib/errors";
import { SOURCE_COLOR, SOURCE_LABEL, SOURCE_ORDER, sortGames } from "../lib/games";
import { hashColor, initials } from "../lib/hash";
import { formatClock, formatSize, relativeTime } from "../lib/time";
import { useGamepad, type PadAction } from "../lib/useGamepad";
import { useHubState } from "../lib/useHubState";
import { useClock, useViewportUnit } from "../lib/useViewport";
import { Backdrop } from "./Backdrop";
import { GameTile } from "./GameTile";
import { Glyph, type InputDevice } from "./Glyph";
import { LaunchOverlay, type LaunchInfo } from "./LaunchOverlay";
import { MENU_ITEMS, SystemMenu } from "./SystemMenu";
import "./game.css";

type TabId = "all" | "recent" | GameSource;
type Zone = "games" | "apps";

interface Tab {
  id: TabId;
  label: string;
}

// Геометрия ряда в единицах макета 1920×1080
const TILE_W = 206;
const TILE_GAP = 22;
const FOCUS_SCALE = 1.36;
const ROW_LEFT = 120;
const RECENT_LIMIT = 24;

export function GameMode() {
  return (
    <ToastProvider variant="game">
      <GameModeInner />
    </ToastProvider>
  );
}

function GameModeInner() {
  const toast = useToast();
  const { state: hub } = useHubState();
  const { unit, width } = useViewportUnit();
  const now = useClock();

  const [games, setGames] = useState<Game[] | null>(null);
  const [launchers, setLaunchers] = useState<LauncherInfo[]>([]);
  const [tab, setTab] = useState<TabId>("all");
  const [zone, setZone] = useState<Zone>("games");
  const [gameIdx, setGameIdx] = useState(0);
  const [appIdx, setAppIdx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuIdx, setMenuIdx] = useState(0);
  const [launching, setLaunching] = useState<LaunchInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastInput, setLastInput] = useState<"keyboard" | "gamepad" | null>(null);
  const [accent, setAccent] = useState("#7c5cff");
  const [coverTick, setCoverTick] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(false);

  const coverSrc = useRef(new Map<string, string | null>());
  const lastLoad = useRef(0);
  const focusedIdRef = useRef<string | null>(null);
  /** id игры в фокусе по итогам последнего коммита — чтобы не потерять фокус при обновлении списка. */
  const stickyIdRef = useRef<string | null>(null);

  // ---------- данные ----------
  const loadGames = useCallback(
    async (refresh: boolean) => {
      if (refresh) setRefreshing(true);
      try {
        const list = sortGames(await api.listGames(refresh));
        lastLoad.current = Date.now();
        setGames(list);
        if (refresh) toast.show({ kind: "success", title: "Библиотека обновлена", text: `${list.length} игр` });
      } catch (e) {
        toast.error(e, "Не удалось загрузить игры");
        setGames((g) => g ?? []);
      } finally {
        setRefreshing(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void loadGames(false);
    api
      .listLaunchers()
      .then(setLaunchers)
      .catch(() => setLaunchers([]));
  }, [loadGames]);

  // Окно игрового режима не уничтожается, а прячется: при возврате обновляем список (lastPlayed мог измениться).
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastLoad.current > 15_000) void loadGames(false);
    };
    const onVis = () => {
      if (!document.hidden) {
        onFocus();
        setMenuOpen(false);
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [loadGames]);

  // ---------- вкладки и список ----------
  const tabs = useMemo<Tab[]>(() => {
    const t: Tab[] = [
      { id: "all", label: "Все" },
      { id: "recent", label: "Недавние" },
    ];
    for (const s of SOURCE_ORDER) if (games?.some((g) => g.source === s)) t.push({ id: s, label: SOURCE_LABEL[s] });
    return t;
  }, [games]);

  const list = useMemo(() => {
    if (!games) return [];
    if (tab === "all") return games;
    if (tab === "recent") return games.filter((g) => g.lastPlayed).slice(0, RECENT_LIMIT);
    return games.filter((g) => g.source === tab);
  }, [games, tab]);

  // при перезагрузке списка сохраняем фокус на той же игре
  useEffect(() => {
    const id = stickyIdRef.current;
    if (!id) return;
    const i = list.findIndex((g) => g.id === id);
    setGameIdx(i >= 0 ? i : (idx) => Math.min(idx, Math.max(0, list.length - 1)));
  }, [list]);

  const focused: Game | null = list[Math.min(gameIdx, list.length - 1)] ?? null;
  focusedIdRef.current = focused?.id ?? null;
  useEffect(() => {
    stickyIdRef.current = focused?.id ?? null;
  }, [focused?.id]);

  // ---------- акцент из обложки ----------
  useEffect(() => {
    if (!focused) return;
    const fallback = hashColor(focused.name);
    const src = coverSrc.current.get(focused.id);
    if (src === undefined) return; // ещё грузится
    let cancelled = false;
    if (!src) setAccent(fallback);
    else void averageImageColor(src, fallback).then((c) => !cancelled && setAccent(c));
    return () => {
      cancelled = true;
    };
  }, [focused, coverTick]);

  const onCover = useCallback((gameId: string, src: string | null) => {
    coverSrc.current.set(gameId, src);
    if (gameId === focusedIdRef.current) setCoverTick((t) => t + 1);
  }, []);

  // ---------- действия ----------
  const launchGame = useCallback(
    async (g: Game) => {
      setLaunching({ title: g.name, covers: g.covers, heroes: g.heroes });
      window.setTimeout(() => setLaunching(null), 2600);
      try {
        await api.launchGame(g.id);
      } catch (e) {
        setLaunching(null);
        toast.error(e, `Не удалось запустить ${g.name}`);
      }
    },
    [toast],
  );

  const launchLauncher = useCallback(
    async (l: LauncherInfo) => {
      setLaunching({ title: l.name, covers: [], heroes: [] });
      window.setTimeout(() => setLaunching(null), 1800);
      try {
        await api.launchLauncher(l.source);
      } catch (e) {
        setLaunching(null);
        toast.error(e, `Не удалось открыть ${l.name}`);
      }
    },
    [toast],
  );

  const openFolder = useCallback(
    (g: Game | null) => {
      if (!g?.installDir) return;
      void api.openPath(g.installDir).catch((e) => toast.error(e));
    },
    [toast],
  );

  const pickMenu = useCallback(
    async (id: string) => {
      setMenuOpen(false);
      try {
        if (id === "exit") await api.exitGameMode();
        else if (id === "refresh") await loadGames(true);
        else if (id === "quit") await api.quitApp();
      } catch (e) {
        toast.error(e);
      }
    },
    [loadGames, toast],
  );

  const switchTab = useCallback(
    (delta: number) => {
      const i = tabs.findIndex((t) => t.id === tab);
      const next = tabs[(i + delta + tabs.length) % tabs.length];
      if (next.id !== tab) {
        setTab(next.id);
        setGameIdx(0);
        setZone("games");
        stickyIdRef.current = null;
      }
    },
    [tabs, tab],
  );

  const handle = useCallback(
    (a: PadAction) => {
      if (launching) return;
      if (menuOpen) {
        if (a === "up") setMenuIdx((i) => (i - 1 + MENU_ITEMS.length) % MENU_ITEMS.length);
        else if (a === "down") setMenuIdx((i) => (i + 1) % MENU_ITEMS.length);
        else if (a === "confirm") void pickMenu(MENU_ITEMS[menuIdx].id);
        else if (a === "back" || a === "menu") setMenuOpen(false);
        return;
      }
      switch (a) {
        case "left":
          if (zone === "games") setGameIdx((i) => Math.max(0, i - 1));
          else setAppIdx((i) => Math.max(0, i - 1));
          break;
        case "right":
          if (zone === "games") setGameIdx((i) => Math.min(list.length - 1, i + 1));
          else setAppIdx((i) => Math.min(launchers.length - 1, i + 1));
          break;
        case "down":
          if (zone === "games" && launchers.length) setZone("apps");
          break;
        case "up":
          if (zone === "apps") setZone("games");
          break;
        case "confirm":
          if (zone === "games" && focused) void launchGame(focused);
          else if (zone === "apps" && launchers[appIdx]) void launchLauncher(launchers[appIdx]);
          break;
        case "folder":
          if (zone === "games") openFolder(focused);
          break;
        case "tabPrev":
          switchTab(-1);
          break;
        case "tabNext":
          switchTab(1);
          break;
        case "menu":
          setMenuIdx(0);
          setMenuOpen(true);
          break;
        case "back":
          if (zone === "apps") setZone("games");
          else if (gameIdx > 0) setGameIdx(0);
          else {
            setMenuIdx(0);
            setMenuOpen(true);
          }
          break;
      }
    },
    [launching, menuOpen, menuIdx, zone, list.length, launchers, focused, appIdx, gameIdx, pickMenu, launchGame, launchLauncher, openFolder, switchTab],
  );

  // геймпад
  const pad = useGamepad(
    useCallback(
      (a: PadAction) => {
        setLastInput("gamepad");
        setCursorVisible(false);
        handle(a);
      },
      [handle],
    ),
  );

  // клавиатура
  useEffect(() => {
    const map: Record<string, PadAction> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      Enter: "confirm",
      NumpadEnter: "confirm",
      Space: "confirm",
      Escape: "back",
      Backspace: "back",
      KeyQ: "tabPrev",
      PageUp: "tabPrev",
      KeyE: "tabNext",
      PageDown: "tabNext",
      KeyF: "folder",
      KeyM: "menu",
      F1: "menu",
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
      const a = map[e.code];
      if (!a) return;
      e.preventDefault();
      setLastInput("keyboard");
      handle(a);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handle]);

  // курсор мыши показываем только когда ей пользуются
  useEffect(() => {
    let t = 0;
    const onMove = () => {
      setCursorVisible(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setCursorVisible(false), 2500);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.clearTimeout(t);
    };
  }, []);

  const device: InputDevice = pad.connected && lastInput !== "keyboard" ? pad.type : "keyboard";

  // ---------- клик мышью ----------
  const onTileSelect = useCallback(
    (id: string) => {
      const i = list.findIndex((g) => g.id === id);
      if (i < 0) return;
      setZone("games");
      if (i === gameIdx) void launchGame(list[i]);
      else setGameIdx(i);
    },
    [list, gameIdx, launchGame],
  );

  // ---------- геометрия ряда ----------
  const u = unit;
  const step = (TILE_W + TILE_GAP) * u;
  const extra = TILE_W * (FOCUS_SCALE - 1) * u;
  const fIdx = Math.min(gameIdx, Math.max(0, list.length - 1));
  const visibleAfter = Math.ceil(width / step) + 1;
  const from = Math.max(0, fIdx - 2);
  const to = Math.min(list.length, fIdx + visibleAfter);

  const activeProfile =
    hub?.config.profiles.find((p) => p.id === (hub.currentProfileId ?? hub.config.activeProfileId)) ?? null;
  // рабочий профиль, куда ведёт «Вернуться к работе»; если он в другой учётке — переход через экран входа
  const workProfile = hub
    ? (hub.config.profiles.find((p) => p.id === hub.config.prevWorkProfileId) ?? hub.config.profiles.find((p) => p.kind === "work"))
    : undefined;
  const workUser =
    workProfile?.windowsUser && hub && workProfile.windowsUser.sid.toLowerCase() !== hub.currentUser.sid.toLowerCase()
      ? workProfile.windowsUser.username
      : null;
  const rootStyle = {
    "--accent": accent,
    "--accent-rgb": hexToRgbTriplet(accent),
    "--glow": accent,
  } as CSSProperties;

  const meta = focused
    ? [
        SOURCE_LABEL[focused.source],
        focused.lastPlayed ? `Запускали ${relativeTime(focused.lastPlayed)}` : "Ещё не запускали",
        formatSize(focused.sizeBytes),
      ].filter(Boolean)
    : [];

  return (
    <div className={`gm${cursorVisible ? " gm--cursor" : ""}${menuOpen ? " gm--menu" : ""}`} style={rootStyle}>
      <Backdrop game={focused} />

      {/* ---------- верхняя панель ---------- */}
      <header className="gm-top">
        <nav className="gm-tabs">
          <Glyph action="tabPrev" device={device} />
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`gm-tab${t.id === tab ? " is-current" : ""}`}
              onClick={() => {
                stickyIdRef.current = null;
                setTab(t.id);
                setGameIdx(0);
                setZone("games");
              }}
            >
              {t.label}
            </button>
          ))}
          <Glyph action="tabNext" device={device} />
        </nav>
        <div className="gm-status">
          {refreshing && <span className="gm-status__sync">Сканируем библиотеку…</span>}
          <span className={`gm-pad${pad.connected ? " is-on" : ""}`} title={pad.connected ? pad.id : "Геймпад не подключён"}>
            <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 11h4M8 9v4M15 12h.01M18 10h.01M17.32 5H6.68a4 4 0 0 0-3.978 3.59l-.6 6A3 3 0 0 0 5.08 18c1.38 0 2.04-.88 2.92-2l.6-.75a2 2 0 0 1 1.56-.75h3.68a2 2 0 0 1 1.56.75L16 16c.88 1.12 1.54 2 2.92 2a3 3 0 0 0 2.98-3.41l-.6-6A4 4 0 0 0 17.32 5z" />
            </svg>
            {pad.connected && <span className="gm-pad__label">{pad.type === "playstation" ? "DualSense" : "Xbox"}</span>}
          </span>
          {activeProfile && (
            <span className="gm-profile">
              <span className="gm-profile__icon">{activeProfile.icon}</span>
              {activeProfile.name}
            </span>
          )}
          <span className="gm-clock">{formatClock(now)}</span>
        </div>
      </header>

      {/* ---------- ряд игр ---------- */}
      <section className={`gm-row${zone === "games" ? " is-active" : ""}`}>
        {games === null ? (
          <div className="gm-row__track">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="tile tile--skeleton" style={{ transform: `translate3d(${ROW_LEFT * u + i * step + (i > 0 ? extra : 0)}px,0,0)` }}>
                <div className="tile__inner" />
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="gm-empty">
            <div className="gm-empty__title">{tab === "recent" ? "Пока ничего не запускали" : "Игры не найдены"}</div>
            <div className="gm-empty__text">
              {tab === "recent" ? "Запущенные отсюда игры появятся в этом разделе." : "Откройте меню и обновите библиотеку."}
            </div>
          </div>
        ) : (
          <div className="gm-row__track">
            {list.slice(from, to).map((g, k) => {
              const i = from + k;
              const x = ROW_LEFT * u + (i - fIdx) * step + (i > fIdx ? extra : 0);
              return (
                <GameTile
                  key={g.id}
                  game={g}
                  x={x}
                  focused={i === fIdx}
                  active={zone === "games"}
                  before={i < fIdx}
                  onCover={onCover}
                  onSelect={onTileSelect}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- инфо о выбранной игре ---------- */}
      <section className={`gm-info${zone === "games" ? "" : " is-dim"}`} key={focused?.id ?? "none"}>
        {focused && (
          <>
            <div className="gm-info__title">
              <FallbackImage
                candidates={focused.logos}
                className="gm-info__logo"
                alt={focused.name}
                fallback={<h1 className="gm-info__name">{focused.name}</h1>}
              />
            </div>
            <div className="gm-info__meta">
              {meta.map((m, i) => (
                <span key={i}>{m}</span>
              ))}
            </div>
            <div className="gm-info__actions">
              <button className={`gm-btn gm-btn--play${zone === "games" ? " is-focused" : ""}`} onClick={() => void launchGame(focused)}>
                <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
                  <path d="M6 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 6 3.5z" />
                </svg>
                Играть
                <Glyph action="confirm" device={device} />
              </button>
              {focused.installDir && (
                <button className="gm-btn" onClick={() => openFolder(focused)}>
                  Папка
                  <Glyph action="folder" device={device} />
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {/* ---------- приложения ---------- */}
      {launchers.length > 0 && (
        <section className={`gm-apps${zone === "apps" ? " is-active" : ""}`}>
          <div className="gm-apps__label">Приложения</div>
          <div className="gm-apps__row">
            {launchers.map((l, i) => (
              <button
                key={l.source}
                className={`gm-app${zone === "apps" && i === appIdx ? " is-focused" : ""}`}
                style={{ "--brand": SOURCE_COLOR[l.source] } as CSSProperties}
                onClick={() => {
                  setZone("apps");
                  if (i === appIdx && zone === "apps") void launchLauncher(l);
                  else setAppIdx(i);
                }}
              >
                <span className="gm-app__icon">{l.source === "battleNet" ? "B" : initials(SOURCE_LABEL[l.source])}</span>
                <span className="gm-app__name">{l.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---------- подсказки ---------- */}
      <footer className="gm-hints">
        <span>
          <Glyph action="nav" device={device} /> Навигация
        </span>
        <span>
          <Glyph action="confirm" device={device} /> {zone === "games" ? "Играть" : "Открыть"}
        </span>
        {zone === "games" && focused?.installDir && (
          <span>
            <Glyph action="folder" device={device} /> Папка
          </span>
        )}
        <span>
          <Glyph action="tabPrev" device={device} />
          <Glyph action="tabNext" device={device} /> Разделы
        </span>
        <span>
          <Glyph action="menu" device={device} /> Меню
        </span>
      </footer>

      {menuOpen && (
        <SystemMenu
          index={menuIdx}
          device={device}
          profile={activeProfile}
          now={now}
          onPick={(id) => void pickMenu(id)}
          onHover={setMenuIdx}
          workUser={workUser}
        />
      )}

      {launching && <LaunchOverlay info={launching} />}
    </div>
  );
}
