import { FallbackImage } from "../components/FallbackImage";
import { hashGradient, initials } from "../lib/hash";

export interface LaunchInfo {
  title: string;
  covers: string[];
  heroes: string[];
}

export function LaunchOverlay({ info }: { info: LaunchInfo }) {
  return (
    <div className="launch">
      <div className="launch__bg">
        <FallbackImage candidates={[...info.heroes, ...info.covers]} className="launch__bg-img" />
      </div>
      <div className="launch__card">
        <FallbackImage
          candidates={info.covers}
          className="launch__cover"
          fallback={
            <div className="launch__cover launch__cover--gen" style={{ background: hashGradient(info.title) }}>
              {initials(info.title)}
            </div>
          }
        />
        <div className="launch__pulse" />
      </div>
      <div className="launch__title">{info.title}</div>
      <div className="launch__status">
        Запуск<span className="launch__dots" />
      </div>
      <div className="launch__bar">
        <span />
      </div>
    </div>
  );
}
