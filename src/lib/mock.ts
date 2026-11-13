/**
 * ТОЛЬКО ДЛЯ РАЗРАБОТКИ: фейковый бэкенд, чтобы UI открывался в обычном браузере
 * (npm run dev → http://localhost:1420). Подключается из main.tsx только при
 * import.meta.env.DEV и отсутствии Tauri, в production-сборку не попадает.
 * Окно игрового режима: http://localhost:1420/?window=game
 */
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { AppConfig, BrowserInfo, Game, HubState, LauncherInfo, ManualGame, Profile, ProjectEntry, Settings } from "../api";

const now = Math.floor(Date.now() / 1000);
const DAY = 86_400;

const steam = (id: number, name: string, lastPlayed: number | null, gb: number): Game => ({
  id: `steam:${id}`,
  name,
  source: "steam",
  covers: [
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`,
  ],
  heroes: [`https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_hero.jpg`],
  logos: [`https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/logo.png`],
  installDir: `D:\\SteamLibrary\\steamapps\\common\\${name}`,
  lastPlayed,
  sizeBytes: gb * 1024 ** 3,
  launch: { type: "uri", uri: `steam://rungameid/${id}` },
});

let games: Game[] = [
  steam(1245620, "ELDEN RING", now - 3600 * 5, 49),
  steam(570, "Dota 2", now - DAY, 38),
  steam(1091500, "Cyberpunk 2077", now - DAY * 3, 70),
  steam(292030, "The Witcher 3: Wild Hunt", now - DAY * 40, 50),
  steam(1086940, "Baldur's Gate 3", null, 122),
  steam(1145360, "Hades", null, 15),
  steam(367520, "Hollow Knight", null, 9),
  steam(413150, "Stardew Valley", null, 0.5),
  steam(730, "Counter-Strike 2", null, 33),
  {
    id: "epic:fortnite",
    name: "Fortnite",
    source: "epic",
    covers: ["https://example.invalid/missing.jpg"],
    heroes: [],
    logos: [],
    installDir: "C:\\Program Files\\Epic Games\\Fortnite",
    lastPlayed: null,
    sizeBytes: 31 * 1024 ** 3,
    launch: null,
  },
  {
    id: "gog:cp2077",
    name: "Disco Elysium",
    source: "gog",
    covers: [],
    heroes: [],
    logos: [],
    installDir: null,
    lastPlayed: now - DAY * 9,
    sizeBytes: null,
    launch: null,
  },
];

const browsers: BrowserInfo[] = [
  { kind: "chrome", name: "Google Chrome", installed: true, exePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
  { kind: "edge", name: "Microsoft Edge", installed: true, exePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" },
  { kind: "firefox", name: "Firefox", installed: true, exePath: "C:\\Program Files\\Mozilla Firefox\\firefox.exe" },
  { kind: "opera", name: "Opera", installed: false, exePath: null },
  { kind: "operaGx", name: "Opera GX", installed: false, exePath: null },
  { kind: "brave", name: "Brave", installed: true, exePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" },
  { kind: "yandex", name: "Яндекс Браузер", installed: false, exePath: null },
];

const launchers: LauncherInfo[] = [
  { source: "steam", name: "Steam", exePath: "C:\\Program Files (x86)\\Steam\\steam.exe" },
  { source: "epic", name: "Epic Games", exePath: "C:\\Program Files\\Epic Games\\Launcher.exe" },
  { source: "gog", name: "GOG Galaxy", exePath: "C:\\Program Files\\GOG Galaxy\\GalaxyClient.exe" },
];

const profile = (p: Partial<Profile> & Pick<Profile, "id" | "name" | "icon" | "color" | "kind">): Profile => ({
  wallpaper: null,
  theme: "dark",
  browsers: [],
  projectsDir: `C:\\Profiles\\${p.id}\\projects`,
  apps: [],
  onLeave: "keep",
  hotkey: null,
  desktopId: null,
  ...p,
});

const settings: Settings = {
  hubHotkey: "Ctrl+Alt+Space",
  gameHotkey: "Ctrl+Alt+G",
  profilesRoot: "C:\\Profiles",
  launchOnStartup: true,
  applyWindowsTheme: true,
};

const config: AppConfig = {
  settings,
  profiles: [
    profile({
      id: "work-a",
      name: "Работа — Финтех",
      icon: "💼",
      color: "#4f8cff",
      kind: "work",
      hotkey: "Ctrl+Alt+1",
      browsers: [{ kind: "chrome", autostart: true }],
      apps: [{ id: "a1", name: "Slack", path: "C:\\Users\\dev\\AppData\\Local\\slack\\slack.exe", args: "", autostart: true }],
    }),
    profile({ id: "work-b", name: "Фриланс", icon: "🚀", color: "#22c55e", kind: "work", theme: "light", onLeave: "closeOnGaming" }),
    profile({ id: "games", name: "Игры", icon: "🎮", color: "#ec4899", kind: "gaming", onLeave: "close", hotkey: "Ctrl+Alt+0" }),
  ],
  activeProfileId: "work-a",
  manualGames: [],
  lastPlayed: {},
};

let running = ["work-a", "work-b"];
const projects: Record<string, ProjectEntry[]> = {
  "work-a": [
    { name: "payments-api", path: "C:\\Profiles\\work-a\\projects\\payments-api", modified: now - 3600 },
    { name: "web-dashboard", path: "C:\\Profiles\\work-a\\projects\\web-dashboard", modified: now - DAY * 2 },
    { name: "infra", path: "C:\\Profiles\\work-a\\projects\\infra", modified: now - DAY * 30 },
  ],
};

const state = (): HubState => structuredClone({ config, browsers, runningProfiles: running, busyHotkeys: [] });
const delay = <T,>(v: T, ms = 120) => new Promise<T>((r) => setTimeout(() => r(v), ms));

export function installMocks() {
  const params = new URLSearchParams(location.search);
  mockWindows(params.get("window") === "game" ? "game" : "main");
  mockConvertFileSrc("windows");

  mockIPC(
    (cmd, payload) => {
      const a = (payload ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "get_state":
          return delay(state());
        case "new_profile_template": {
          const id = crypto.randomUUID().slice(0, 8);
          const kind = a.kind as Profile["kind"];
          return delay(
            profile({ id, name: kind === "gaming" ? "Игры" : "Новый профиль", icon: kind === "gaming" ? "🎮" : "💻", color: "#a855f7", kind }),
          );
        }
        case "save_profile": {
          const p = a.profile as Profile;
          const i = config.profiles.findIndex((x) => x.id === p.id);
          if (i >= 0) config.profiles[i] = p;
          else config.profiles.push(p);
          return delay(state(), 300);
        }
        case "delete_profile":
          config.profiles = config.profiles.filter((p) => p.id !== a.id);
          if (config.activeProfileId === a.id) config.activeProfileId = config.profiles[0]?.id ?? null;
          return delay(state());
        case "switch_profile":
          config.activeProfileId = a.id as string;
          if (!running.includes(a.id as string)) running = [...running, a.id as string];
          return delay(state(), 600);
        case "save_settings":
          config.settings = a.settings as Settings;
          return delay(state());
        case "close_profile_apps":
          running = running.filter((r) => r !== a.profileId);
          return delay(state());
        case "list_projects":
          return delay(projects[a.profileId as string] ?? []);
        case "create_project": {
          const p: ProjectEntry = { name: a.name as string, path: `C:\\Profiles\\${a.profileId}\\projects\\${a.name}`, modified: Math.floor(Date.now() / 1000) };
          (projects[a.profileId as string] ??= []).unshift(p);
          return delay(p);
        }
        case "list_games":
          return delay(games, a.refresh ? 1200 : 300);
        case "list_launchers":
          return delay(launchers);
        case "launch_game": {
          const g = games.find((x) => x.id === a.gameId);
          if (g) {
            g.lastPlayed = Math.floor(Date.now() / 1000);
            games = [...games];
          }
          return delay(undefined);
        }
        case "add_manual_game": {
          const m = a.game as ManualGame;
          config.manualGames.push(m);
          games = [
            ...games,
            {
              id: `manual:${m.id}`,
              name: m.name,
              source: "manual",
              covers: m.cover ? [m.cover] : [],
              heroes: m.hero ? [m.hero] : [],
              logos: [],
              installDir: null,
              lastPlayed: null,
              sizeBytes: null,
              launch: null,
            },
          ];
          return delay(state());
        }
        case "remove_manual_game":
          config.manualGames = config.manualGames.filter((m) => m.id !== a.id);
          games = games.filter((g) => g.id !== `manual:${a.id}`);
          return delay(state());
        case "launch_browser":
        case "launch_app":
        case "open_projects_dir":
        case "open_in_editor":
        case "open_path":
        case "launch_launcher":
        case "enter_game_mode":
        case "exit_game_mode":
        case "hide_hub":
        case "quit_app":
          console.info("[mock]", cmd, a);
          return delay(undefined);
        case "plugin:dialog|open":
          return delay(
            (a.options as { directory?: boolean } | undefined)?.directory ? "C:\\Users\\dev\\Projects" : "C:\\Users\\dev\\Pictures\\wallpaper.jpg",
          );
        default:
          if (cmd.startsWith("plugin:window|")) return null;
          console.warn("[mock] неизвестная команда", cmd, a);
          return Promise.reject(`Команда ${cmd} не реализована в моке`);
      }
    },
    { shouldMockEvents: true },
  );
}
