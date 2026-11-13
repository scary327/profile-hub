/**
 * ТОЛЬКО ДЛЯ РАЗРАБОТКИ: фейковый бэкенд, чтобы UI открывался в обычном браузере
 * (npm run dev → http://localhost:1420). Подключается из main.tsx только при
 * import.meta.env.DEV и отсутствии Tauri, в production-сборку не попадает.
 * Окно игрового режима: http://localhost:1420/?window=game (&pad=ps / &pad=xbox — фейковый геймпад).
 * Хаб в непривязанной учётке: http://localhost:1420/?unlinked=1
 */
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { AppConfig, BrowserInfo, Game, HubState, LauncherInfo, ManualGame, Profile, ProjectEntry, Settings, WindowsUser, WinUserInfo } from "../api";

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

const SID = (rid: number) => `S-1-5-21-3623811015-3361044348-30300820-${rid}`;
const user = (rid: number, username: string, fullName: string, p: Partial<WinUserInfo> = {}): WinUserInfo => ({
  sid: SID(rid),
  username,
  fullName,
  enabled: true,
  loggedIn: false,
  isCurrent: false,
  ...p,
});

let windowsUsers: WinUserInfo[] = [
  user(500, "Administrator", "", { enabled: false }),
  user(501, "Guest", "", { enabled: false }),
  user(1001, "dev", "Илья", { loggedIn: true }),
  user(1002, "Frilans", "Фриланс", { loggedIn: true }),
  user(1003, "old-test", "Старая учётка"),
];

const params = new URLSearchParams(location.search);
/** ?unlinked=1 — хаб открыт в учётке, которая не привязана ни к одному профилю. */
const unlinked = !!params.get("unlinked");
const currentSid = unlinked ? SID(1003) : SID(1001);
if (unlinked) windowsUsers = windowsUsers.map((u) => (u.sid === currentSid ? { ...u, loggedIn: true } : u));

const linkOf = (u: WinUserInfo): WindowsUser => ({ sid: u.sid, username: u.username });
const homeProjects = (username: string) => `C:\\Users\\${username}\\Projects`;

const profile = (p: Partial<Profile> & Pick<Profile, "id" | "name" | "icon" | "color" | "kind">): Profile => ({
  wallpaper: null,
  theme: "dark",
  browsers: [],
  projectsDir: p.windowsUser ? homeProjects(p.windowsUser.username) : "",
  apps: [],
  onLeave: "keep",
  hotkey: null,
  windowsUser: null,
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
      windowsUser: linkOf(windowsUsers[2]),
      browsers: [{ kind: "chrome", autostart: true }],
      apps: [{ id: "a1", name: "Slack", path: "C:\\Users\\dev\\AppData\\Local\\slack\\slack.exe", args: "", autostart: true }],
    }),
    profile({
      id: "work-b",
      name: "Фриланс",
      icon: "🚀",
      color: "#22c55e",
      kind: "work",
      theme: "light",
      onLeave: "signOutOnGaming",
      windowsUser: linkOf(windowsUsers[3]),
    }),
    profile({ id: "games", name: "Игры", icon: "🎮", color: "#ec4899", kind: "gaming", onLeave: "signOut", hotkey: "Ctrl+Alt+0" }),
  ],
  activeProfileId: "work-a",
  manualGames: [],
  lastPlayed: {},
  prevWorkProfileId: "work-a",
  pendingGameModeSid: null,
};

const projects: Record<string, ProjectEntry[]> = {
  "work-a": [
    { name: "payments-api", path: "C:\\Users\\dev\\Projects\\payments-api", modified: now - 3600 },
    { name: "web-dashboard", path: "C:\\Users\\dev\\Projects\\web-dashboard", modified: now - DAY * 2 },
    { name: "infra", path: "C:\\Users\\dev\\Projects\\infra", modified: now - DAY * 30 },
  ],
};

const profileOf = (sid: string) => config.profiles.find((p) => p.windowsUser?.sid === sid) ?? null;

const state = (): HubState => {
  const users = windowsUsers.map((u) => ({ ...u, isCurrent: u.sid === currentSid }));
  const current = users.find((u) => u.isCurrent)!;
  return structuredClone({
    config,
    browsers,
    runningProfiles: config.profiles.filter((p) => users.some((u) => u.sid === p.windowsUser?.sid && u.loggedIn)).map((p) => p.id),
    busyHotkeys: [],
    currentUser: current,
    currentProfileId: profileOf(currentSid)?.id ?? null,
    windowsUsers: users,
  });
};
const delay = <T,>(v: T, ms = 120) => new Promise<T>((r) => setTimeout(() => r(v), ms));

/**
 * ?pad=ps | ?pad=xbox — фейковый геймпад, чтобы проверить значки кнопок в игровом режиме.
 * mockIPC выставляет __TAURI_INTERNALS__, поэтому useGamepad идёт «нативным» путём через get_gamepad_info.
 */
const padParam = params.get("pad");
const padInfo =
  padParam === "ps"
    ? { connected: true, type: "playstation", id: "DualSense Wireless Controller (mock)" }
    : padParam === "xbox"
      ? { connected: true, type: "xbox", id: "Xbox Wireless Controller (mock)" }
      : { connected: false, type: "xbox", id: "" };

export function installMocks() {
  mockWindows(params.get("window") === "game" ? "game" : "main");
  mockConvertFileSrc("windows");

  mockIPC(
    (cmd, payload) => {
      const a = (payload ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "get_gamepad_info":
          return delay(padInfo);
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
          // учёткой управляют отдельные команды — сохранённую привязку не перетираем
          if (i >= 0) config.profiles[i] = { ...p, windowsUser: config.profiles[i].windowsUser };
          else config.profiles.push({ ...p, windowsUser: null });
          return delay(state(), 300);
        }
        case "delete_profile": {
          const p = config.profiles.find((x) => x.id === a.id);
          const wu = p?.windowsUser;
          if (a.deleteData && wu) {
            if (wu.sid === currentSid) return Promise.reject("Нельзя удалить учётку, в которой вы сейчас");
            windowsUsers = windowsUsers.filter((u) => u.sid !== wu.sid);
          }
          config.profiles = config.profiles.filter((x) => x.id !== a.id);
          if (config.activeProfileId === a.id) config.activeProfileId = config.profiles[0]?.id ?? null;
          return delay(state(), a.deleteData ? 1200 : 120);
        }
        case "switch_profile": {
          const wu = config.profiles.find((x) => x.id === a.id)?.windowsUser;
          if (!wu) return Promise.reject("У профиля нет учётки Windows — сначала создайте её");
          if (wu.sid !== currentSid) {
            console.info("[mock] экран входа Windows → выберите", wu.username);
            windowsUsers = windowsUsers.map((u) => (u.sid === wu.sid ? { ...u, loggedIn: true } : u));
          }
          return delay(state(), 600);
        }
        case "create_windows_user": {
          const p = config.profiles.find((x) => x.id === a.profileId);
          const username = a.username as string;
          if (!p) return Promise.reject("Профиль не найден");
          if (windowsUsers.some((u) => u.username.toLowerCase() === username.toLowerCase()))
            return Promise.reject(`Пользователь ${username} уже существует`);
          const u = user(1004 + windowsUsers.length, username, p.name);
          windowsUsers = [...windowsUsers, u];
          p.windowsUser = linkOf(u);
          p.projectsDir = homeProjects(username);
          console.info("[mock] create_windows_user", username, a.password === null ? "(без пароля)" : "(с паролем)");
          return delay(state(), 1500);
        }
        case "link_current_user":
        case "link_windows_user": {
          const p = config.profiles.find((x) => x.id === a.profileId);
          const sid = cmd === "link_current_user" ? currentSid : (a.sid as string);
          const u = windowsUsers.find((x) => x.sid === sid);
          if (!p || !u) return Promise.reject("Профиль или учётка не найдены");
          const owner = profileOf(sid);
          if (owner && owner.id !== p.id) return Promise.reject(`Учётка ${u.username} уже привязана к профилю «${owner.name}»`);
          p.windowsUser = linkOf(u);
          if (!p.projectsDir) p.projectsDir = homeProjects(u.username);
          return delay(state(), 300);
        }
        case "unlink_windows_user": {
          const p = config.profiles.find((x) => x.id === a.profileId);
          if (p) p.windowsUser = null;
          return delay(state());
        }
        case "save_settings":
          config.settings = a.settings as Settings;
          return delay(state());
        case "close_profile_apps":
          return delay(state());
        case "list_projects":
          return delay(projects[a.profileId as string] ?? []);
        case "create_project": {
          const dir = config.profiles.find((x) => x.id === a.profileId)?.projectsDir ?? "C:\\Projects";
          const p: ProjectEntry = { name: a.name as string, path: `${dir}\\${a.name}`, modified: Math.floor(Date.now() / 1000) };
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
