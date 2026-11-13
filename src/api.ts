// КОНТРАКТ с Rust-бэкендом (src-tauri/src/models.rs + commands.rs).
// Не менять имена команд/полей без синхронного изменения на стороне Rust.

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ProfileKind = "work" | "gaming";
export type ThemeMode = "dark" | "light";
export type LeaveBehavior = "keep" | "close" | "closeOnGaming";
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
  desktopId: string | null;
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
}

export interface AppConfig {
  settings: Settings;
  profiles: Profile[];
  activeProfileId: string | null;
  manualGames: ManualGame[];
  lastPlayed: Record<string, number>;
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
  runningProfiles: string[];
  /** Хоткеи, занятые другими программами. */
  busyHotkeys: string[];
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
  deleteProfile: (id: string, deleteData: boolean) => invoke<HubState>("delete_profile", { id, deleteData }),
  switchProfile: (id: string) => invoke<HubState>("switch_profile", { id }),
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
};

/** Бэкенд шлёт "state-changed" с HubState после переключения по хоткею и т.п. */
export function onStateChanged(cb: (s: HubState) => void): Promise<UnlistenFn> {
  return listen<HubState>("state-changed", (e) => cb(e.payload));
}
