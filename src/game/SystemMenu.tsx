import type { Profile } from "../api";
import { formatClock } from "../lib/time";
import { Glyph, type InputDevice } from "./Glyph";

export interface MenuItem {
  id: string;
  label: string;
  hint: string;
  icon: string;
  danger?: boolean;
  /** Отметка выбранного варианта (подменю). */
  checked?: boolean;
  /** Пункт открывает подменю. */
  submenu?: boolean;
}

export const MENU_ITEMS: MenuItem[] = [
  { id: "exit", label: "Вернуться к работе", hint: "Закрыть игровой режим и вернуться в рабочий профиль", icon: "💼" },
  { id: "screen", label: "Экран", hint: "Перенести игровой режим на другой монитор", icon: "🖥", submenu: true },
  { id: "refresh", label: "Обновить библиотеку", hint: "Заново просканировать Steam, Epic, GOG и другие лаунчеры", icon: "🔄" },
  { id: "quit", label: "Выход из приложения", hint: "Полностью закрыть Profile Hub", icon: "⏻", danger: true },
];

interface Props {
  items: MenuItem[];
  index: number;
  device: InputDevice;
  profile: Profile | null;
  now: Date;
  onPick: (id: string) => void;
  onHover: (i: number) => void;
  /** Подменю: заголовок вместо часов и «Назад» вместо «Закрыть». */
  title?: string;
  subtitle?: string;
  onBack?: () => void;
}

export function SystemMenu({ items, index, device, profile, now, onPick, onHover, title, subtitle, onBack }: Props) {
  return (
    <div className="sysmenu">
      <div className={`sysmenu__panel${title ? " is-sub" : ""}`} key={title ?? "root"}>
        {title ? (
          <div className="sysmenu__head">
            <button className="sysmenu__crumb" onClick={onBack}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Меню
            </button>
            <div className="sysmenu__title">{title}</div>
            {subtitle && <div className="sysmenu__subtitle">{subtitle}</div>}
          </div>
        ) : (
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
        )}
        <div className="sysmenu__items">
          {items.map((it, i) => (
            <button
              key={it.id}
              className={`sysmenu__item${i === index ? " is-focused" : ""}${it.danger ? " is-danger" : ""}${it.checked ? " is-checked" : ""}`}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(it.id)}
            >
              <span className="sysmenu__icon">{it.icon}</span>
              <span className="sysmenu__text">
                <span className="sysmenu__label">{it.label}</span>
                <span className="sysmenu__hint">{it.hint}</span>
              </span>
              {it.checked && (
                <span className="sysmenu__check" aria-label="выбран">
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M4.5 10.5l3.6 3.6 7.4-8.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
              {it.submenu && (
                <span className="sysmenu__chev" aria-hidden="true">
                  <svg viewBox="0 0 20 20">
                    <path d="M7.5 4.5L13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="sysmenu__foot">
          <span>
            <Glyph action="confirm" device={device} /> Выбрать
          </span>
          <span>
            <Glyph action="back" device={device} /> {title ? "Назад" : "Закрыть"}
          </span>
        </div>
      </div>
    </div>
  );
}
