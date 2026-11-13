// КОНТРАКТ с Rust-бэкендом (src-tauri/src/models.rs + commands.rs).
// Не менять имена команд/полей без синхронного изменения на стороне Rust.

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ProfileKind = "work" | "gaming";
export type ThemeMode = "dark" | "light";
/** Что делать с сеансом Windows профиля при уходе из него. */
export type LeaveBehavior = "keep" | "signOut" | "signOutOnGaming";
export type BrowserKind = "chrome" | "edge" | "firefox" | "opera" | "operaGx" | "brave" | "yandex";
export type GameSource = "steam" | "epic" | "gog" | "ubisoft" | "ea" | "battleNet" | "manual";

export interface ProfileBrowser {
  kind: BrowserKind;
  autostart: boolean;
}

export interface ProfileApp {
  id: string;
  name: string;
  path: string;
  args: string;
  autostart: boolean;
}

export interface Profile {
  id: string;
  name: string;
  icon: string; // эмодзи
  color: string; // #RRGGBB
  kind: ProfileKind;
  wallpaper: string | null;
  theme: ThemeMode;
  browsers: ProfileBrowser[];
  projectsDir: string;
  apps: ProfileApp[];
  onLeave: LeaveBehavior;
  hotkey: string | null; // "Ctrl+Alt+1"
  /** Учётка Windows профиля; null — ещё не создана/не привязана. */
  windowsUser: WindowsUser | null;
}

/** Каждый профиль — отдельный пользователь Windows. */
export interface WindowsUser {
  sid: string;
  username: string;
}

export interface WinUserInfo {
  sid: string;
  username: string;
  fullName: string;
  enabled: boolean;
  /** Есть сеанс (вошёл, активен или в фоне). */
  loggedIn: boolean;
  /** Пользователь текущего сеанса. */
  isCurrent: boolean;
}

export interface ManualGame {
  id: string;
  name: string;
  exePath: string;
  args: string;
  cover: string | null;
  hero: string | null;
}

export interface Settings {
  hubHotkey: string;
  gameHotkey: string;
  profilesRoot: string;
  launchOnStartup: boolean;
  applyWindowsTheme: boolean;
  /** Монитор игрового режима (MonitorInfo.name); null — основной. */
  gameMonitor: string | null;
  /** Источник панели по умолчанию: "web" (встроенный браузер) или DockApp.id. null = "web". */
  panelSource: string | null;
  /** Открывать игровой режим при включении геймпада (если игра сейчас не запущена). */
  autoGameModeOnPad: boolean;
}

/** Беспроводное устройство с батареей (Bluetooth-наушники, мышь и т.п.). Геймпад — в GamepadInfo. */
export interface DeviceBattery {
  name: string;
  /** 0..100 */
  percent: number;
  kind: "gamepad" | "headset" | "mouse" | "keyboard" | "other";
}

/** Приложение, чьё окно можно пристыковать в панель игрового режима. */
export interface DockApp {
  /** "chrome" | "edge" | "firefox" | "opera" | "operaGx" | "brave" | "yandex" | "discord" | "telegram" | "steamChat" */
  id: string;
  name: string;
  kind: "browser" | "voice";
  installed: boolean;
}

/** Пристыкованное сейчас окно (null — ничего). */
export interface DockState {
  appId: string;
  title: string;
  visible: boolean;
}

export interface Bookmark {
  name: string;
  url: string;
}

export interface MonitorInfo {
  /** Системное имя (\\.\DISPLAY2) — передаётся в moveGameToMonitor. */
  name: string;
  /** «Экран 2 · 2560×1440» */
  label: string;
  width: number;
  height: number;
  primary: boolean;
  /** Окно игрового режима сейчас на этом мониторе. */
  current: boolean;
}

/** Запущенная сейчас игра. */
export interface RunningGame {
  gameId: string;
  /** unix seconds */
  startedAt: number;
}

export interface VoiceApps {
  discord: boolean;
  steam: boolean;
}

/** Прямоугольник в CSS-пикселях относительно окна (getBoundingClientRect). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppConfig {
  settings: Settings;
  profiles: Profile[];
  activeProfileId: string | null;
  manualGames: ManualGame[];
  lastPlayed: Record<string, number>;
  prevWorkProfileId: string | null;
  /** Внутреннее: учётка, где после входа откроется игровой режим. */
  pendingGameModeSid: string | null;
  /** Закладки встроенного браузера игрового режима. */
  voiceBookmarks: Bookmark[];
}

export interface BrowserInfo {
  kind: BrowserKind;
  name: string;
  installed: boolean;
  exePath: string | null;
}

export interface HubState {
  config: AppConfig;
  browsers: BrowserInfo[];
  /** Профили, чья учётка сейчас в системе. */
  runningProfiles: string[];
  /** Хоткеи, занятые другими программами. */
  busyHotkeys: string[];
  currentUser: WinUserInfo;
  /** Профиль текущей учётки; null — учётка не привязана ни к одному профилю. */
  currentProfileId: string | null;
  windowsUsers: WinUserInfo[];
}

export interface Game {
  id: string; // "steam:570"
  name: string;
  source: GameSource;
  covers: string[]; // URL или локальные пути, по приоритету
  heroes: string[];
  logos: string[];
  installDir: string | null;
  lastPlayed: number | null; // unix seconds
  sizeBytes: number | null;
  launch: unknown; // внутреннее, не трогать
}

export interface LauncherInfo {
  source: GameSource;
  name: string;
  exePath: string;
}

export interface ProjectEntry {
  name: string;
  path: string;
  modified: number | null; // unix seconds
}

/** Превращает URL или локальный путь в src для <img>. */
export function imageSrc(pathOrUrl: string): string {
  if (/^(https?:|data:|asset:|blob:)/i.test(pathOrUrl)) return pathOrUrl;
  return convertFileSrc(pathOrUrl);
}

export const api = {
  getState: () => invoke<HubState>("get_state"),
  /** Шаблон нового профиля с id и папками по умолчанию (ещё не сохранён). */
  newProfileTemplate: (kind: ProfileKind) => invoke<Profile>("new_profile_template", { kind }),
  /** Создать или обновить профиль (по id). */
  saveProfile: (profile: Profile) => invoke<HubState>("save_profile", { profile }),
  /** deleteData=true — удалить и учётку Windows профиля вместе с её папкой (UAC). Текущую учётку удалить нельзя. */
  deleteProfile: (id: string, deleteData: boolean) => invoke<HubState>("delete_profile", { id, deleteData }),
  /**
   * Перейти в профиль. Если это другая учётка — текущий сеанс уходит на экран входа Windows,
   * где нужно выбрать пользователя профиля и войти (PIN/пароль). Команда успевает вернуть состояние до этого.
   */
  switchProfile: (id: string) => invoke<HubState>("switch_profile", { id }),

  /** Создать учётку Windows для профиля (запрос UAC). password=null — без пароля. */
  createWindowsUser: (profileId: string, username: string, password: string | null) =>
    invoke<HubState>("create_windows_user", { profileId, username, password }),
  /** Привязать к профилю учётку текущего сеанса. */
  linkCurrentUser: (profileId: string) => invoke<HubState>("link_current_user", { profileId }),
  /** Привязать к профилю существующую учётку по SID. */
  linkWindowsUser: (profileId: string, sid: string) => invoke<HubState>("link_windows_user", { profileId, sid }),
  unlinkWindowsUser: (profileId: string) => invoke<HubState>("unlink_windows_user", { profileId }),
  saveSettings: (settings: Settings) => invoke<HubState>("save_settings", { settings }),

  launchBrowser: (profileId: string, kind: BrowserKind) => invoke<void>("launch_browser", { profileId, kind }),
  launchApp: (profileId: string, appId: string) => invoke<void>("launch_app", { profileId, appId }),
  closeProfileApps: (profileId: string) => invoke<HubState>("close_profile_apps", { profileId }),

  openProjectsDir: (profileId: string) => invoke<void>("open_projects_dir", { profileId }),
  listProjects: (profileId: string) => invoke<ProjectEntry[]>("list_projects", { profileId }),
  createProject: (profileId: string, name: string) => invoke<ProjectEntry>("create_project", { profileId, name }),
  /** Открыть папку в VS Code (если есть), иначе в Проводнике. */
  openInEditor: (path: string) => invoke<void>("open_in_editor", { path }),
  openPath: (path: string) => invoke<void>("open_path", { path }),

  listGames: (refresh: boolean) => invoke<Game[]>("list_games", { refresh }),
  launchGame: (gameId: string) => invoke<void>("launch_game", { gameId }),
  listLaunchers: () => invoke<LauncherInfo[]>("list_launchers"),
  launchLauncher: (source: GameSource) => invoke<void>("launch_launcher", { source }),
  addManualGame: (game: ManualGame) => invoke<HubState>("add_manual_game", { game }),
  removeManualGame: (id: string) => invoke<HubState>("remove_manual_game", { id }),

  /** Показать полноэкранное окно игрового режима (переключает на игровой профиль, если он есть). */
  enterGameMode: () => invoke<void>("enter_game_mode"),
  /** Выйти из игрового режима и вернуться в предыдущий рабочий профиль. */
  exitGameMode: () => invoke<void>("exit_game_mode"),
  hideHub: () => invoke<void>("hide_hub"),
  quitApp: () => invoke<void>("quit_app"),

  // ---------- игровой режим: монитор ----------
  listMonitors: () => invoke<MonitorInfo[]>("list_monitors"),
  /** Перенести окно игрового режима на монитор и запомнить выбор. */
  moveGameToMonitor: (name: string) => invoke<void>("move_game_to_monitor", { name }),

  // ---------- игровой режим: запущенные игры ----------
  /** Какие игры из библиотеки запущены сейчас (дёшево, можно опрашивать раз в 2–3 с). */
  runningGames: () => invoke<RunningGame[]>("running_games"),
  /** Вывести окно запущенной игры на передний план. */
  focusGame: (gameId: string) => invoke<void>("focus_game", { gameId }),

  // ---------- игровой режим: голос и встроенный браузер ----------
  voiceApps: () => invoke<VoiceApps>("voice_apps"),
  /** Открыть (или вывести на передний план) приложение Discord. */
  openDiscord: () => invoke<void>("open_discord"),
  /** Открыть друзей и чаты Steam (оттуда же звонки). */
  openSteamChat: () => invoke<void>("open_steam_chat"),
  /**
   * Встроенный браузер внутри окна игр: настоящий WebView поверх области `rect`
   * (сайт со звонком получает микрофон; входы хранятся в учётке Windows).
   * Если браузер уже открыт — переходит на `url` (url=null — оставить текущую страницу) и встаёт в `rect`.
   */
  browserOpen: (url: string | null, rect: Rect) => invoke<void>("browser_open", { url, rect }),
  /** Обновить положение/размер (при ресайзе окна или панели). */
  browserSetBounds: (rect: Rect) => invoke<void>("browser_set_bounds", { rect }),
  /** Спрятать панель, не закрывая страницу (звонок продолжается). */
  browserHide: () => invoke<void>("browser_hide"),
  /** Закрыть страницу совсем (звонок завершится). */
  browserClose: () => invoke<void>("browser_close"),
  browserNav: (action: "back" | "forward" | "reload") => invoke<void>("browser_nav", { action }),
  saveVoiceBookmarks: (bookmarks: Bookmark[]) => invoke<HubState>("save_voice_bookmarks", { bookmarks }),

  // ---------- игровой режим: окна приложений в панели ----------
  /** Что можно пристыковать (установленные браузеры, Discord, Telegram, чаты Steam). */
  listDockApps: () => invoke<DockApp[]>("list_dock_apps"),
  /**
   * Пристыковать окно приложения в панель поверх `rect` (как browserOpen: rect — область-заглушка в CSS px).
   * Если приложение не запущено — запускает. Для браузера с `url` открывает новое окно с этим адресом
   * (это обычный браузер пользователя: его профиль, входы, вкладки). Если это же приложение уже
   * пристыковано — просто показывает и ставит в `rect` (url=null) или открывает url в нём.
   * Ждёт появления окна до ~10 с. Ранее пристыкованное другое приложение отстыковывается.
   */
  dockOpen: (appId: string, url: string | null, rect: Rect) => invoke<DockState>("dock_open", { appId, url, rect }),
  dockSetBounds: (rect: Rect) => invoke<void>("dock_set_bounds", { rect }),
  /** Спрятать пристыкованное окно (приложение работает, звонок продолжается). */
  dockHide: () => invoke<void>("dock_hide"),
  /** Отстыковать: вернуть окну обычный вид и место на рабочем столе. */
  dockRelease: () => invoke<void>("dock_release"),
  dockState: () => invoke<DockState | null>("dock_state"),
  /** Заряд беспроводных устройств Windows (кэш, обновляется раз в минуту; можно опрашивать раз в 30–60 с). */
  deviceBatteries: () => invoke<DeviceBattery[]>("device_batteries"),
  /** Запомнить источник панели по умолчанию ("web" или DockApp.id). */
  setPanelSource: (source: string) => invoke<HubState>("set_panel_source", { source }),
};

/** Пристыкованное окно изменилось (закрылось само, отстыковано и т.п.); null — ничего не пристыковано. */
export function onDockChanged(cb: (s: DockState | null) => void): Promise<UnlistenFn> {
  return listen<DockState | null>("dock-changed", (e) => cb(e.payload));
}

/** Встроенный браузер перешёл на новую страницу. */
export function onBrowserUrl(cb: (url: string) => void): Promise<UnlistenFn> {
  return listen<string>("browser-url", (e) => cb(e.payload));
}

/** Бэкенд шлёт "state-changed" с HubState после переключения по хоткею и т.п. */
export function onStateChanged(cb: (s: HubState) => void): Promise<UnlistenFn> {
  return listen<HubState>("state-changed", (e) => cb(e.payload));
}
