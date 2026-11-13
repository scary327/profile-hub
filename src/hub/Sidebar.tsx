import type { CSSProperties } from "react";
import type { HubState, Profile } from "../api";
import { Icon } from "../components/Icon";
import { hexToRgbTriplet, isHexColor } from "../lib/color";
import type { HubView } from "./Hub";
import { KIND_LABEL, accountInfo, type AccountStatus } from "./profileUtils";

interface Props {
  profiles: Profile[];
  state: HubState | null;
  selectedId: string | null;
  /** Несохранённый новый профиль (показываем его карточкой в списке). */
  draft: Profile | null;
  view: HubView;
  onSelect: (id: string) => void;
  onNew: () => void;
  onView: (v: HubView) => void;
}

function cardStyle(color: string): CSSProperties {
  const c = isHexColor(color) ? color : "#7c5cff";
  return { "--pc": c, "--pc-rgb": hexToRgbTriplet(c) } as CSSProperties;
}

const ACCOUNT_BADGE: Record<AccountStatus, { glyph: string; title: (u: string) => string }> = {
  current: { glyph: "👤", title: (u) => `Учётка ${u} — вы сейчас в ней` },
  loggedIn: { glyph: "👤", title: (u) => `Учётка ${u} — сеанс открыт в фоне` },
  linked: { glyph: "🔒", title: (u) => `Учётка ${u} — не в системе, вход по PIN/паролю` },
  none: { glyph: "∅", title: () => "Нет своей учётки Windows" },
};

export function Sidebar({ profiles, state, selectedId, draft, view, onSelect, onNew, onView }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar__section-title">
        Профили <span className="sidebar__count">{profiles.length}</span>
      </div>
      <nav className="sidebar__list">
        {profiles.map((p, i) => {
          const acc = state ? accountInfo(state, p) : { status: "none" as const, user: null };
          const active = acc.status === "current";
          const running = acc.status === "loggedIn";
          const badge = ACCOUNT_BADGE[acc.status];
          return (
            <button
              key={p.id}
              className={`pcard${p.id === selectedId ? " is-selected" : ""}${active ? " is-active" : ""}`}
              style={cardStyle(p.color)}
              onClick={() => onSelect(p.id)}
              title={active ? "Профиль учётки, в которой вы сейчас" : undefined}
            >
              <span className="pcard__icon">{p.icon || "•"}</span>
              <span className="pcard__main">
                <span className="pcard__name">{p.name || "Без имени"}</span>
                <span className="pcard__meta">
                  <span className={`badge badge--${p.kind}`}>{KIND_LABEL[p.kind]}</span>
                  {active ? (
                    <span className="pcard__status">вы здесь</span>
                  ) : running ? (
                    <span className="pcard__status pcard__status--bg">в фоне</span>
                  ) : acc.status === "none" ? (
                    <span className="pcard__status pcard__status--warn">нет учётки</span>
                  ) : null}
                </span>
              </span>
              <span className="pcard__side">
                <span
                  className={`pcard__acc pcard__acc--${acc.status}`}
                  title={badge.title(p.windowsUser?.username ?? "")}
                  aria-label={badge.title(p.windowsUser?.username ?? "")}
                >
                  {badge.glyph}
                </span>
                {i < 9 && <kbd className="kbd kbd--sm">{i + 1}</kbd>}
              </span>
            </button>
          );
        })}
        {draft && (
          <button className="pcard is-selected is-draft" style={cardStyle(draft.color)}>
            <span className="pcard__icon">{draft.icon || "•"}</span>
            <span className="pcard__main">
              <span className="pcard__name">{draft.name || "Новый профиль"}</span>
              <span className="pcard__meta">
                <span className={`badge badge--${draft.kind}`}>{KIND_LABEL[draft.kind]}</span>
                <span className="pcard__status">не сохранён</span>
              </span>
            </span>
          </button>
        )}
        <button className="sidebar__new" onClick={onNew}>
          <Icon name="plus" size={15} /> Новый профиль
        </button>
      </nav>

      <div className="sidebar__bottom">
        <button className={`navlink${view === "library" ? " is-current" : ""}`} onClick={() => onView("library")}>
          <Icon name="gamepad" size={17} />
          Игровая библиотека
        </button>
        <button className={`navlink${view === "settings" ? " is-current" : ""}`} onClick={() => onView("settings")}>
          <Icon name="settings" size={17} />
          Настройки
        </button>
      </div>
    </aside>
  );
}
