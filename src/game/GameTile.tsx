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
  onCover: (gameId: string, src: string | null) => void;
  onSelect: (gameId: string) => void;
}

/** Плитка игры. Позиция — только transform, чтобы анимации шли на композиторе. */
export const GameTile = memo(function GameTile({ game, x, focused, active, before, onCover, onSelect }: Props) {
  const style = { transform: `translate3d(${x}px, 0, 0)` } as CSSProperties;
  return (
    <div
      className={`tile${focused ? " is-focused" : ""}${focused && active ? " is-active" : ""}${before ? " is-before" : ""}`}
      style={style}
      onClick={() => onSelect(game.id)}
    >
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
      </div>
    </div>
  );
});
