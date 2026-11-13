import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, type Bookmark, type Game, type GameSource, type LauncherInfo, type MonitorInfo, type RunningGame, type VoiceApps } from "../api";
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
import { BrowserPanel, hostOf, SiteIcon, useBrowserPanel } from "./BrowserPanel";
import { GameTile } from "./GameTile";
import { Glyph, type InputDevice } from "./Glyph";
import { LaunchOverlay, type LaunchInfo } from "./LaunchOverlay";
import { MENU_ITEMS, SystemMenu, type MenuItem } from "./SystemMenu";
import "./game.css";

type TabId = "all" | "recent" | GameSource;
/** chip — «▶ игра» в верхней панели, dock — нижний ряд «Голос и чаты» + «Приложения». */
type Zone = "chip" | "games" | "dock";

interface Tab {
  id: TabId;
  label: string;
}

type DockItem =
  | { key: string; group: "voice"; kind: "discord" | "steamChat" | "browser" }
  | { key: string; group: "voice"; kind: "bookmark"; bm: Bookmark }
  | { key: string; group: "apps"; kind: "launcher"; l: LauncherInfo };

// Геометрия ряда в единицах макета 1920×1080
const TILE_W = 206;
const TILE_GAP = 22;
const FOCUS_SCALE = 1.36;
const ROW_LEFT = 120;
const RECENT_LIMIT = 24;
const RUNNING_POLL_MS = 2500;

/** «1 ч 12 мин», «7 мин», «меньше минуты». */
function sessionLength(startedAt: number, nowMs: number): string {
  const min = Math.max(0, Math.floor((nowMs / 1000 - startedAt) / 60));
  if (min < 1) return "меньше минуты";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function GameMode() {
  return (
    <ToastProvider variant="game">
      <GameModeInner />
    </ToastProvider>
  );
}

function GameModeInner() {
  const toast = useToast();
  const { state: hub, setState: setHub } = useHubState();
  const { unit, width } = useViewportUnit();
  const now = useClock();

  const [games, setGames] = useState<Game[] | null>(null);
  const [launchers, setLaunchers] = useState<LauncherInfo[]>([]);
  const [tab, setTab] = useState<TabId>("all");
  const [zone, setZone] = useState<Zone>("games");
  const [gameIdx, setGameIdx] = useState(0);
  const [dockIdx, setDockIdx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuLevel, setMenuLevel] = useState<"root" | "screen">("root");
  const [menuIdx, setMenuIdx] = useState(0);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [launching, setLaunching] = useState<LaunchInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastInput, setLastInput] = useState<"keyboard" | "gamepad" | null>(null);
  const [accent, setAccent] = useState("#7c5cff");
  const [coverTick, setCoverTick] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(false);
  const [running, setRunning] = useState<RunningGame[]>([]);
  const [voice, setVoice] = useState<VoiceApps>({ discord: false, steam: false });
  const [sessionNow, setSessionNow] = useState(() => Date.now());
  /** Запрос «поставить фокус на игру» (запущенная игра, клик по чипу). */
  const [focusReq, setFocusReq] = useState<{ id: string; seq: number } | null>(null);
  const [dockShift, setDockShift] = useState(0);

  const coverSrc = useRef(new Map<string, string | null>());
  const lastLoad = useRef(0);
  const focusedIdRef = useRef<string | null>(null);
  /** id игры в фокусе по итогам последнего коммита — чтобы не потерять фокус при обновлении списка. */
  const stickyIdRef = useRef<string | null>(null);
  /** При открытии игрового режима — фокус на запущенную игру (как только узнаем, что запущено). */
  const wantRunningFocus = useRef(true);
  const reqSeq = useRef(0);
  const panelPad = useRef<((a: PadAction) => void) | null>(null);
  const dockRowRef = useRef<HTMLDivElement>(null);

  const browser = useBrowserPanel(menuOpen || !!launching);
  const panelActive = browser.phase === "opening" || browser.phase === "open";

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

  const requestFocus = useCallback((id: string) => setFocusReq({ id, seq: ++reqSeq.current }), []);

  const pollRunning = useCallback(async () => {
    try {
      // последняя запущенная — первой (в ряду и в чипе)
      const r = [...(await api.runningGames())].sort((a, b) => b.startedAt - a.startedAt);
      setRunning((prev) =>
        prev.length === r.length && prev.every((p, i) => p.gameId === r[i].gameId && p.startedAt === r[i].startedAt) ? prev : r,
      );
      if (wantRunningFocus.current) {
        wantRunningFocus.current = false;
        if (r[0]) requestFocus(r[0].gameId);
      }
    } catch {
      /* бэкенд без поддержки — просто нет подсветки */
    }
  }, [requestFocus]);

  const loadMonitors = useCallback(() => {
    api
      .listMonitors()
      .then(setMonitors)
      .catch(() => setMonitors([]));
  }, []);

  useEffect(() => {
    void loadGames(false);
    api
      .listLaunchers()
      .then(setLaunchers)
      .catch(() => setLaunchers([]));
    api
      .voiceApps()
      .then(setVoice)
      .catch(() => {});
    loadMonitors();
  }, [loadGames, loadMonitors]);

  // запущенные игры: опрос, пока окно видно
  useEffect(() => {
    void pollRunning();
    const t = window.setInterval(() => {
      if (!document.hidden) void pollRunning();
    }, RUNNING_POLL_MS);
    return () => window.clearInterval(t);
  }, [pollRunning]);

  // длительность сессии обновляем раз в 30 с
  useEffect(() => {
    const t = window.setInterval(() => setSessionNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // Окно игрового режима не уничтожается, а прячется: при возврате обновляем список (lastPlayed мог измениться).
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastLoad.current > 15_000) void loadGames(false);
      setSessionNow(Date.now());
      void pollRunning();
    };
    const onVis = () => {
      if (!document.hidden) {
        wantRunningFocus.current = true;
        onFocus();
        setMenuOpen(false);
        api
          .voiceApps()
          .then(setVoice)
          .catch(() => {});
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [loadGames, pollRunning]);

  // ---------- вкладки и список ----------
  const tabs = useMemo<Tab[]>(() => {
    const t: Tab[] = [
      { id: "all", label: "Все" },
      { id: "recent", label: "Недавние" },
    ];
    for (const s of SOURCE_ORDER) if (games?.some((g) => g.source === s)) t.push({ id: s, label: SOURCE_LABEL[s] });
    return t;
  }, [games]);

  const runMap = useMemo(() => new Map(running.map((r) => [r.gameId, r.startedAt])), [running]);
  const runKey = running.map((r) => r.gameId).join("|");

  const list = useMemo(() => {
    if (!games) return [];
    const ids = runKey ? runKey.split("|") : [];
    const live = new Set(ids);
    // запущенные — в начало ряда (в порядке запуска: последняя первой), остальной порядок не трогаем
    const liveFirst = (l: Game[]) =>
      live.size
        ? [...l.filter((g) => live.has(g.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)), ...l.filter((g) => !live.has(g.id))]
        : l;
    if (tab === "all") return liveFirst(games);
    if (tab === "recent") return liveFirst(games.filter((g) => g.lastPlayed || live.has(g.id))).slice(0, RECENT_LIMIT);
    return games.filter((g) => g.source === tab);
  }, [games, tab, runKey]);

  // при перезагрузке списка сохраняем фокус на той же игре
  useEffect(() => {
    const id = stickyIdRef.current;
    if (!id) return;
    const i = list.findIndex((g) => g.id === id);
    setGameIdx(i >= 0 ? i : (idx) => Math.min(idx, Math.max(0, list.length - 1)));
  }, [list]);

  // запрос фокуса на конкретную игру (после sticky-эффекта — он главнее)
  useEffect(() => {
    if (!focusReq || !games) return;
    const i = list.findIndex((g) => g.id === focusReq.id);
    if (i >= 0) {
      stickyIdRef.current = focusReq.id;
      setGameIdx(i);
      setZone("games");
      setFocusReq(null);
    } else if (tab !== "all") {
      setTab("all");
    } else {
      setFocusReq(null);
    }
  }, [focusReq, list, games, tab]);

  const focused: Game | null = list[Math.min(gameIdx, list.length - 1)] ?? null;
  focusedIdRef.current = focused?.id ?? null;
  useEffect(() => {
    stickyIdRef.current = focused?.id ?? null;
  }, [focused?.id]);
  const focusedStartedAt = focused ? runMap.get(focused.id) : undefined;
  const focusedLive = focusedStartedAt !== undefined;

  const runningGames = useMemo(
    () => running.map((r) => games?.find((g) => g.id === r.gameId)).filter((g): g is Game => !!g),
    [running, games],
  );

  // ---------- нижний ряд: голос и чаты + приложения ----------
  const bookmarks = useMemo(() => hub?.config.voiceBookmarks ?? [], [hub]);
  const dockItems = useMemo<DockItem[]>(() => {
    const items: DockItem[] = [];
    if (voice.discord) items.push({ key: "discord", group: "voice", kind: "discord" });
    if (voice.steam) items.push({ key: "steamChat", group: "voice", kind: "steamChat" });
    items.push({ key: "browser", group: "voice", kind: "browser" });
    for (const bm of bookmarks) items.push({ key: `bm:${bm.url}`, group: "voice", kind: "bookmark", bm });
    for (const l of launchers) items.push({ key: `l:${l.source}`, group: "apps", kind: "launcher", l });
    return items;
  }, [voice, bookmarks, launchers]);
  const dIdx = Math.min(dockIdx, Math.max(0, dockItems.length - 1));

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
        window.setTimeout(() => void pollRunning(), 3000);
      } catch (e) {
        setLaunching(null);
        toast.error(e, `Не удалось запустить ${g.name}`);
      }
    },
    [toast, pollRunning],
  );

  const resumeGame = useCallback(
    (g: Game) => {
      void api.focusGame(g.id).catch((e) => toast.error(e, `Не удалось вернуться в ${g.name}`));
    },
    [toast],
  );

  /** Главное действие для игры: запущена — вернуться в неё, иначе запустить. */
  const playOrResume = useCallback(
    (g: Game) => {
      if (runMap.has(g.id)) resumeGame(g);
      else void launchGame(g);
    },
    [runMap, resumeGame, launchGame],
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

  const activateDock = useCallback(
    (it: DockItem) => {
      switch (it.kind) {
        case "discord":
          void api.openDiscord().catch((e) => toast.error(e, "Не удалось открыть Discord"));
          break;
        case "steamChat":
          void api.openSteamChat().catch((e) => toast.error(e, "Не удалось открыть чаты Steam"));
          break;
        case "browser":
          browser.show(null);
          break;
        case "bookmark":
          browser.show(it.bm.url);
          break;
        case "launcher":
          void launchLauncher(it.l);
          break;
      }
    },
    [browser, launchLauncher, toast],
  );

  const saveBookmarks = useCallback(
    (b: Bookmark[]) => {
      api
        .saveVoiceBookmarks(b)
        .then(setHub)
        .catch((e) => toast.error(e, "Не удалось сохранить закладки"));
    },
    [setHub, toast],
  );

  const openFolder = useCallback(
    (g: Game | null) => {
      if (!g?.installDir) return;
      void api.openPath(g.installDir).catch((e) => toast.error(e));
    },
    [toast],
  );

  // ---------- системное меню ----------
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

  const currentMonitor = monitors.find((m) => m.current);
  const rootItems = useMemo<MenuItem[]>(
    () =>
      MENU_ITEMS.filter((it) => it.id !== "screen" || monitors.length > 1).map((it) => {
        if (it.id === "exit" && workUser)
          return { ...it, label: "Вернуться к работе (экран входа)", hint: `Откроется экран входа Windows — выберите «${workUser}»` };
        if (it.id === "screen" && currentMonitor) return { ...it, hint: `Сейчас: ${currentMonitor.label}` };
        return it;
      }),
    [monitors.length, workUser, currentMonitor],
  );
  const screenItems = useMemo<MenuItem[]>(
    () =>
      monitors.map((m) => ({
        id: `mon:${m.name}`,
        label: m.label,
        hint:
          [
            m.label.includes(`${m.width}×${m.height}`) ? "" : `${m.width} × ${m.height}`,
            m.primary ? "основной монитор" : "",
            m.current ? "игровой режим сейчас здесь" : "",
          ]
            .filter(Boolean)
            .join(" · ") || "Перенести игровой режим сюда",
        icon: "🖥",
        checked: m.current,
      })),
    [monitors],
  );
  const menuItems = menuLevel === "screen" ? screenItems : rootItems;

  const openMenu = useCallback(() => {
    loadMonitors();
    setMenuLevel("root");
    setMenuIdx(0);
    setMenuOpen(true);
  }, [loadMonitors]);

  const menuBack = useCallback(() => {
    if (menuLevel === "screen") {
      setMenuLevel("root");
      setMenuIdx(Math.max(0, rootItems.findIndex((it) => it.id === "screen")));
    } else setMenuOpen(false);
  }, [menuLevel, rootItems]);

  const pickMenu = useCallback(
    async (id: string) => {
      if (id === "screen") {
        setMenuLevel("screen");
        setMenuIdx(Math.max(0, monitors.findIndex((m) => m.current)));
        return;
      }
      setMenuOpen(false);
      try {
        if (id.startsWith("mon:")) {
          const m = monitors.find((x) => x.name === id.slice(4));
          if (m && !m.current) {
            await api.moveGameToMonitor(m.name);
            toast.show({ kind: "success", title: "Игровой режим перенесён", text: m.label });
            window.setTimeout(loadMonitors, 600);
          }
        } else if (id === "exit") await api.exitGameMode();
        else if (id === "refresh") await loadGames(true);
        else if (id === "quit") await api.quitApp();
      } catch (e) {
        toast.error(e);
      }
    },
    [monitors, loadGames, loadMonitors, toast],
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
        const n = menuItems.length;
        if (a === "up") setMenuIdx((i) => (i - 1 + n) % n);
        else if (a === "down") setMenuIdx((i) => (i + 1) % n);
        else if (a === "confirm" && menuItems[menuIdx]) void pickMenu(menuItems[menuIdx].id);
        else if (a === "back") menuBack();
        else if (a === "menu") setMenuOpen(false);
        return;
      }
      // открытая панель браузера забирает ввод; кнопка «голос» / ○ / B её сворачивают
      if (panelActive) {
        if (a === "voice") browser.hide();
        else if (a === "menu") openMenu();
        else panelPad.current?.(a);
        return;
      }
      switch (a) {
        case "left":
          if (zone === "games") setGameIdx((i) => Math.max(0, i - 1));
          else if (zone === "dock") setDockIdx(Math.max(0, dIdx - 1));
          break;
        case "right":
          if (zone === "games") setGameIdx((i) => Math.min(list.length - 1, i + 1));
          else if (zone === "dock") setDockIdx(Math.min(dockItems.length - 1, dIdx + 1));
          break;
        case "down":
          if (zone === "chip") setZone("games");
          else if (zone === "games" && dockItems.length) setZone("dock");
          break;
        case "up":
          if (zone === "dock") setZone("games");
          else if (zone === "games" && runningGames.length) setZone("chip");
          break;
        case "confirm":
          if (zone === "games" && focused) playOrResume(focused);
          else if (zone === "dock" && dockItems[dIdx]) activateDock(dockItems[dIdx]);
          else if (zone === "chip" && runningGames[0]) requestFocus(runningGames[0].id);
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
        case "voice":
          browser.show(null);
          break;
        case "menu":
          openMenu();
          break;
        case "back":
          if (zone !== "games") setZone("games");
          else if (gameIdx > 0) setGameIdx(0);
          else openMenu();
          break;
      }
    },
    [
      launching,
      menuOpen,
      menuItems,
      menuIdx,
      pickMenu,
      menuBack,
      panelActive,
      browser,
      openMenu,
      zone,
      dIdx,
      list.length,
      dockItems,
      runningGames,
      focused,
      playOrResume,
      activateDock,
      requestFocus,
      openFolder,
      switchTab,
      gameIdx,
    ],
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
      KeyV: "voice",
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
      const a = map[e.code];
      if (!a) return;
      // V только открывает панель; закрывают Esc и кнопки панели
      if (a === "voice" && panelActive) return;
      e.preventDefault();
      setLastInput("keyboard");
      handle(a);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handle, panelActive]);

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
      if (i === gameIdx) playOrResume(list[i]);
      else setGameIdx(i);
    },
    [list, gameIdx, playOrResume],
  );

  // ---------- прокрутка нижнего ряда к элементу в фокусе ----------
  useLayoutEffect(() => {
    const row = dockRowRef.current;
    const view = row?.parentElement;
    if (!row || !view) return;
    const el = row.querySelector<HTMLElement>(`[data-dock="${dIdx}"]`);
    if (!el) return;
    const viewW = view.clientWidth;
    const pad = 40 * unit;
    setDockShift((s) => {
      const left = el.offsetLeft;
      const right = left + el.offsetWidth * 1.12;
      if (left - s < 0) return Math.max(0, left - pad);
      if (right - s > viewW) return Math.max(0, right - viewW + pad);
      return Math.min(s, Math.max(0, row.scrollWidth - viewW));
    });
  }, [dIdx, zone, dockItems.length, unit, width, browser.shown]);

  // ---------- геометрия ряда ----------
  const u = unit;
  const step = (TILE_W + TILE_GAP) * u;
  const extra = TILE_W * (FOCUS_SCALE - 1) * u;
  const fIdx = Math.min(gameIdx, Math.max(0, list.length - 1));
  const visibleAfter = Math.ceil(width / step) + 1;
  const from = Math.max(0, fIdx - 2);
  const to = Math.min(list.length, fIdx + visibleAfter);

  const rootStyle = {
    "--accent": accent,
    "--accent-rgb": hexToRgbTriplet(accent),
    "--glow": accent,
  } as CSSProperties;

  const meta: Array<{ text: string; live?: boolean }> = focused
    ? [
        focusedLive
          ? { text: `Сейчас играете · ${sessionLength(focusedStartedAt!, sessionNow)}`, live: true }
          : { text: focused.lastPlayed ? `Запускали ${relativeTime(focused.lastPlayed)}` : "Ещё не запускали" },
        { text: SOURCE_LABEL[focused.source] },
        { text: formatSize(focused.sizeBytes) },
      ].filter((m) => m.text)
    : [];

  const showFocus = lastInput !== null;
  const gamesActive = zone === "games" && !panelActive;
  const dockFocused = zone === "dock" && !panelActive;

  const hints: Array<{ glyphs: ReactNode; label: string }> = panelActive
    ? [
        { glyphs: <Glyph action="nav" device={device} />, label: "Выбор" },
        { glyphs: <Glyph action="confirm" device={device} />, label: "Открыть" },
        ...(browser.alive
          ? [
              {
                glyphs: (
                  <>
                    <Glyph action="tabPrev" device={device} />
                    <Glyph action="tabNext" device={device} />
                  </>
                ),
                label: "Назад / вперёд",
              },
            ]
          : []),
        {
          glyphs: (
            <>
              <Glyph action="back" device={device} />
              <Glyph action="voice" device={device} />
            </>
          ),
          label: "Свернуть",
        },
      ]
    : [
        { glyphs: <Glyph action="nav" device={device} />, label: "Навигация" },
        {
          glyphs: <Glyph action="confirm" device={device} />,
          label: zone === "games" ? (focusedLive ? "Вернуться в игру" : "Играть") : zone === "chip" ? "К игре" : "Открыть",
        },
        ...(zone === "games" && focused?.installDir ? [{ glyphs: <Glyph action="folder" device={device} />, label: "Папка" }] : []),
        {
          glyphs: (
            <>
              <Glyph action="tabPrev" device={device} />
              <Glyph action="tabNext" device={device} />
            </>
          ),
          label: "Разделы",
        },
        { glyphs: <Glyph action="voice" device={device} />, label: browser.alive ? "Звонок" : "Браузер" },
        { glyphs: <Glyph action="menu" device={device} />, label: "Меню" },
      ];

  const chipGame = runningGames[0] ?? null;

  const renderDockItem = (it: DockItem, i: number) => {
    const isF = dockFocused && i === dIdx;
    const common = {
      "data-dock": i,
      onClick: () => {
        setZone("dock");
        setDockIdx(i);
        activateDock(it);
      },
    };
    if (it.kind === "bookmark")
      return (
        <button key={it.key} className={`gm-app gm-app--site${isF ? " is-focused" : ""}`} title={it.bm.url} {...common}>
          <SiteIcon bm={it.bm} className="site-icon--dock" />
          <span className="gm-app__caption">{it.bm.name}</span>
        </button>
      );
    if (it.kind === "launcher")
      return (
        <button
          key={it.key}
          className={`gm-app${isF ? " is-focused" : ""}`}
          style={{ "--brand": SOURCE_COLOR[it.l.source] } as CSSProperties}
          {...common}
        >
          <span className="gm-app__icon">{it.l.source === "battleNet" ? "B" : initials(SOURCE_LABEL[it.l.source])}</span>
          <span className="gm-app__name">{it.l.name}</span>
        </button>
      );
    const spec = {
      discord: { name: "Discord", brand: "#5865f2", icon: VOICE_ICONS.discord, sub: "Голосовые каналы" },
      steamChat: { name: "Чаты Steam", brand: "#1a9fff", icon: VOICE_ICONS.chat, sub: "Друзья и звонки" },
      browser: { name: "Браузер", brand: "#8b5cf6", icon: VOICE_ICONS.globe, sub: browser.alive ? "активно" : "Meet, Telegram…" },
    }[it.kind];
    const activeBrowser = it.kind === "browser" && browser.alive;
    return (
      <button
        key={it.key}
        className={`gm-app gm-app--voice${isF ? " is-focused" : ""}${activeBrowser ? " is-live" : ""}`}
        style={{ "--brand": spec.brand } as CSSProperties}
        {...common}
      >
        <span className="gm-app__icon">{spec.icon}</span>
        <span className="gm-app__text">
          <span className="gm-app__name">{spec.name}</span>
          <span className="gm-app__sub">
            {activeBrowser && <span className="live-dot" />}
            {spec.sub}
          </span>
        </span>
      </button>
    );
  };

  const voiceCount = dockItems.filter((d) => d.group === "voice").length;

  return (
    <div
      className={`gm${cursorVisible ? " gm--cursor" : ""}${menuOpen ? " gm--menu" : ""}${browser.shown ? " gm--bp" : ""}${browser.expanded ? " gm--bp-wide" : ""}`}
      style={rootStyle}
    >
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
          {chipGame && (
            <button
              className={`gm-nowplaying${zone === "chip" && !panelActive ? " is-focused" : ""}`}
              title="Перейти к запущенной игре"
              onClick={() => requestFocus(chipGame.id)}
            >
              <span className="live-dot" />
              <svg viewBox="0 0 20 20" aria-hidden="true" className="gm-nowplaying__play">
                <path d="M6 4.2v11.6a.8.8 0 0 0 1.2.7l9.4-5.8a.8.8 0 0 0 0-1.4L7.2 3.5a.8.8 0 0 0-1.2.7z" fill="currentColor" />
              </svg>
              <span className="gm-nowplaying__name">{chipGame.name}</span>
              {runningGames.length > 1 && <span className="gm-nowplaying__more">+{runningGames.length - 1}</span>}
            </button>
          )}
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
      <section className={`gm-row${gamesActive ? " is-active" : ""}`}>
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
                  active={gamesActive}
                  before={i < fIdx}
                  live={runMap.has(g.id)}
                  onCover={onCover}
                  onSelect={onTileSelect}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- инфо о выбранной игре ---------- */}
      <section className={`gm-info${gamesActive ? "" : " is-dim"}`} key={focused?.id ?? "none"}>
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
                <span key={i} className={m.live ? "is-live" : undefined}>
                  {m.live && <span className="live-dot" />}
                  {m.text}
                </span>
              ))}
            </div>
            <div className="gm-info__actions">
              <button
                className={`gm-btn gm-btn--play${focusedLive ? " gm-btn--resume" : ""}${gamesActive ? " is-focused" : ""}`}
                onClick={() => playOrResume(focused)}
              >
                {focusedLive ? (
                  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 7l-5 5 5 5M4 12h11a5 5 0 0 0 0-10h-1" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
                    <path d="M6 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 6 3.5z" />
                  </svg>
                )}
                {focusedLive ? "Вернуться в игру" : "Играть"}
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

      {/* ---------- голос и чаты + приложения ---------- */}
      {dockItems.length > 0 && (
        <section className={`gm-dock${dockFocused ? " is-active" : ""}`}>
          <div className="gm-dock__row" ref={dockRowRef} style={{ transform: `translate3d(${-dockShift}px,0,0)` }}>
            <div className="gm-dock__group">
              <div className="gm-apps__label">Голос и чаты</div>
              <div className="gm-apps__row">{dockItems.slice(0, voiceCount).map((it, i) => renderDockItem(it, i))}</div>
            </div>
            {dockItems.length > voiceCount && (
              <div className="gm-dock__group">
                <div className="gm-apps__label">Приложения</div>
                <div className="gm-apps__row">{dockItems.slice(voiceCount).map((it, k) => renderDockItem(it, voiceCount + k))}</div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---------- подсказки ---------- */}
      <footer className="gm-hints">
        {hints.map((h, i) => (
          <span key={i}>
            {h.glyphs} {h.label}
          </span>
        ))}
      </footer>

      {/* ---------- звонок в фоне ---------- */}
      {browser.alive && !browser.shown && (
        <button className="gm-callpill" onClick={() => browser.show(null)}>
          <span className="gm-callpill__mic">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M10 12.6a2.6 2.6 0 0 0 2.6-2.6V5.2a2.6 2.6 0 1 0-5.2 0V10a2.6 2.6 0 0 0 2.6 2.6zM5.2 9.6a4.8 4.8 0 0 0 9.6 0M10 14.4v2.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="gm-callpill__text">
            <span className="gm-callpill__title">Звонок в браузере</span>
            {browser.url && <span className="gm-callpill__host">{hostOf(browser.url)}</span>}
          </span>
          <Glyph action="voice" device={device} />
        </button>
      )}

      {/* ---------- встроенный браузер ---------- */}
      {browser.shown && (
        <BrowserPanel ctl={browser} bookmarks={bookmarks} onSaveBookmarks={saveBookmarks} device={device} showFocus={showFocus} padRef={panelPad} />
      )}

      {menuOpen && (
        <SystemMenu
          items={menuItems}
          index={menuIdx}
          device={device}
          profile={activeProfile}
          now={now}
          onPick={(id) => void pickMenu(id)}
          onHover={setMenuIdx}
          title={menuLevel === "screen" ? "Экран" : undefined}
          subtitle={menuLevel === "screen" ? "Игровой режим откроется на весь выбранный монитор" : undefined}
          onBack={menuBack}
        />
      )}

      {launching && <LaunchOverlay info={launching} />}
    </div>
  );
}

const VI = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
    {children}
  </svg>
);

const VOICE_ICONS = {
  // нейтральные значки (без логотипов): гарнитура, облачко чата, глобус
  discord: (
    <VI>
      <path
        d="M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM20 14a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2zM17 18c0 1.7-2 3-5 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </VI>
  ),
  chat: (
    <VI>
      <path
        d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.4A7.5 7.5 0 1 1 20 11.5zM9 11.5h.01M12.5 11.5h.01M16 11.5h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </VI>
  ),
  globe: (
    <VI>
      <path
        d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.6 5.6 3.6 9s-1.1 6.4-3.6 9c-2.5-2.6-3.6-5.6-3.6-9S9.5 5.6 12 3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </VI>
  ),
};
