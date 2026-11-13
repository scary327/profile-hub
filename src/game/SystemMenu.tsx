import type { Profile } from "../api";
import { formatClock } from "../lib/time";
import { Glyph, type InputDevice } from "./Glyph";

export interface MenuItem {
  id: string;
  label: string;
  hint: string;
  icon: string;
}

export const MENU_ITEMS: MenuItem[] = [
  { id: "exit", label: "Вернуться к работе", hint: "Закрыть игровой режим и вернуться в рабочий профиль", icon: "💼" },
  { id: "refresh", label: "Обновить библиотеку", hint: "Заново просканировать Steam, Epic, GOG и другие лаунчеры", icon: "🔄" },
  { id: "quit", label: "Выход из приложения", hint: "Полностью закрыть Profile Hub", icon: "⏻" },
];

interface Props {
  index: number;
  device: InputDevice;
  profile: Profile | null;
  now: Date;
  onPick: (id: string) => void;
  onHover: (i: number) => void;
}

export function SystemMenu({ index, device, profile, now, onPick, onHover }: Props) {
  return (
    <div className="sysmenu">
      <div className="sysmenu__panel">
        <div className="sysmenu__head">
          <div className="sysmenu__clock">{formatClock(now)}</div>
          <div className="sysmenu__date">
            {now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
          </div>
          {profile && (
            <div className="sysmenu__profile">
              <span>{profile.icon}</span> {profile.name}
            </div>
          )}
        </div>
        <div className="sysmenu__items">
          {MENU_ITEMS.map((it, i) => (
            <button
              key={it.id}
              className={`sysmenu__item${i === index ? " is-focused" : ""}${it.id === "quit" ? " is-danger" : ""}`}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(it.id)}
            >
              <span className="sysmenu__icon">{it.icon}</span>
              <span className="sysmenu__text">
                <span className="sysmenu__label">{it.label}</span>
                <span className="sysmenu__hint">{it.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="sysmenu__foot">
          <span>
            <Glyph action="confirm" device={device} /> Выбрать
          </span>
          <span>
            <Glyph action="back" device={device} /> Закрыть
          </span>
        </div>
      </div>
    </div>
  );
}
