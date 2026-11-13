import type { Game, GameSource } from "../api";

export const SOURCE_LABEL: Record<GameSource, string> = {
  steam: "Steam",
  epic: "Epic",
  gog: "GOG",
  ubisoft: "Ubisoft",
  ea: "EA",
  battleNet: "Battle.net",
  manual: "Свои",
};

/** Порядок вкладок источников. */
export const SOURCE_ORDER: GameSource[] = ["steam", "epic", "gog", "ubisoft", "ea", "battleNet", "manual"];

export const SOURCE_COLOR: Record<GameSource, string> = {
  steam: "#1b6fb3",
  epic: "#4a4a4a",
  gog: "#86328a",
  ubisoft: "#0070ff",
  ea: "#ff4747",
  battleNet: "#148eff",
  manual: "#7c5cff",
};

/** lastPlayed по убыванию, затем по имени. */
export function sortGames(games: Game[]): Game[] {
  return [...games].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.name.localeCompare(b.name, "ru"));
}
