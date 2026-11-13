import { memo, type CSSProperties } from "react";
import type { Game } from "../api";
import { FallbackImage } from "../components/FallbackImage";
import { hashGradient, initials } from "../lib/hash";

interface Props {
  game: Game;
  x: number;
  focused: boolean;
  active: boolean;
  before: boolean;
  /** Игра сейчас запущена. */
  live: boolean;
  onCover: (gameId: string, src: string | null) => void;
  onSelect: (gameId: string) => void;
}

/** Плитка игры. Позиция — только transform, чтобы анимации шли на композиторе. */
export const GameTile = memo(function GameTile({ game, x, focused, active, before, live, onCover, onSelect }: Props) {
  const style = { transform: `translate3d(${x}px, 0, 0)` } as CSSProperties;
  return (
    <div
      className={`tile${focused ? " is-focused" : ""}${focused && active ? " is-active" : ""}${before ? " is-before" : ""}${live ? " tile--live" : ""}`}
      style={style}
      onClick={() => onSelect(game.id)}
    >
      {/* вращающееся кольцо «идёт игра»: под обложкой, масштабируется вместе с ней */}
      {live && (
        <div className="tile__ring" aria-hidden="true">
          <div className="tile__ring-spin" />
        </div>
      )}
      <div className="tile__inner">
        <FallbackImage
          candidates={game.covers}
          className="tile__img"
          onResolved={(src) => onCover(game.id, src)}
          fallback={
            <div className="tile__gen" style={{ background: hashGradient(game.name) }}>
              <span className="tile__initials">{initials(game.name)}</span>
              <span className="tile__gen-name">{game.name}</span>
            </div>
          }
        />
        <div className="tile__shine" />
        {live && (
          <span className="tile__live">
            <span className="live-dot" />
            Играете
          </span>
        )}
      </div>
    </div>
  );
});
