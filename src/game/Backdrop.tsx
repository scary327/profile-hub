import { memo, useEffect, useRef, useState } from "react";
import type { Game } from "../api";
import { FallbackImage } from "../components/FallbackImage";
import { hashGradient } from "../lib/hash";

interface Layer {
  key: number;
  game: Game | null;
}

/** Полноэкранный фон: hero сфокусированной игры с кроссфейдом и медленным Ken Burns. */
export function Backdrop({ game }: { game: Game | null }) {
  const [layers, setLayers] = useState<Layer[]>(() => [{ key: 0, game }]);
  const seq = useRef(0);
  const gameId = game?.id ?? null;

  useEffect(() => {
    // небольшая задержка — не грузим фоны, пока пользователь быстро листает ряд
    const t = window.setTimeout(() => {
      setLayers((ls) => {
        if (ls[ls.length - 1]?.game?.id === gameId) return ls;
        const next = [...ls, { key: ++seq.current, game }];
        return next.slice(-3);
      });
    }, 160);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // убираем старые слои, когда новый уже проявился
  useEffect(() => {
    if (layers.length <= 1) return;
    const t = window.setTimeout(() => setLayers((ls) => ls.slice(-1)), 1600);
    return () => window.clearTimeout(t);
  }, [layers]);

  return (
    <div className="backdrop" aria-hidden="true">
      {layers.map((l) => (
        <BackdropLayer key={l.key} game={l.game} />
      ))}
      <div className="backdrop__shade" />
      <div className="backdrop__tint" />
      <div className="backdrop__grain" />
    </div>
  );
}

const BackdropLayer = memo(function BackdropLayer({ game }: { game: Game | null }) {
  if (!game) return <div className="backdrop__layer backdrop__layer--empty" />;
  const generated = (
    <div className="backdrop__generated" style={{ background: hashGradient(game.name) }} />
  );
  return (
    <div className="backdrop__layer">
      <div className="backdrop__kb">
        <FallbackImage
          candidates={game.heroes}
          className="backdrop__img"
          fallback={<FallbackImage candidates={game.covers} className="backdrop__img backdrop__img--blur" fallback={generated} />}
        />
      </div>
    </div>
  );
});
