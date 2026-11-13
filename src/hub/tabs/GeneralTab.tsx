import { useState } from "react";
import { HotkeyInput } from "../../components/HotkeyInput";
import { Icon } from "../../components/Icon";
import { isHexColor } from "../../lib/color";
import type { TabProps } from "../ProfileEditor";
import { LEAVE_OPTIONS, PROFILE_COLORS, PROFILE_EMOJIS } from "../profileUtils";

export function GeneralTab({ draft, update }: TabProps) {
  const [hexText, setHexText] = useState(draft.color);
  const [hexFor, setHexFor] = useState(draft.color);
  if (hexFor !== draft.color) {
    setHexFor(draft.color);
    setHexText(draft.color);
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="field">
          <label className="field__label" htmlFor="pname">
            Название
          </label>
          <input
            id="pname"
            className="input input--lg"
            value={draft.name}
            maxLength={40}
            placeholder="Например, «Работа — Яндекс»"
            onChange={(e) => update({ name: e.target.value })}
          />
        </div>

        <div className="field">
          <div className="field__label">Иконка</div>
          <div className="emoji-picker">
            <div className="emoji-picker__current">
              <span className="emoji-picker__preview">{draft.icon || "•"}</span>
              <input
                className="input emoji-picker__input"
                value={draft.icon}
                maxLength={12}
                aria-label="Своя иконка"
                title="Можно вставить любой эмодзи (Win + .)"
                onChange={(e) => update({ icon: e.target.value.trim() })}
              />
            </div>
            <div className="emoji-grid">
              {PROFILE_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  className={`emoji-grid__item${draft.icon === em ? " is-current" : ""}`}
                  onClick={() => update({ icon: em })}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="field">
          <div className="field__label">Акцентный цвет</div>
          <div className="swatches">
            {PROFILE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch${draft.color.toLowerCase() === c ? " is-current" : ""}`}
                style={{ background: c }}
                title={c}
                onClick={() => update({ color: c })}
              />
            ))}
            <label className="swatch swatch--custom" title="Свой цвет">
              <input type="color" value={isHexColor(draft.color) ? draft.color : "#7c5cff"} onChange={(e) => update({ color: e.target.value })} />
              <Icon name="plus" size={14} />
            </label>
            <input
              className="input input--mono swatches__hex"
              value={hexText}
              maxLength={7}
              spellCheck={false}
              onChange={(e) => {
                const v = e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value;
                setHexText(v);
                if (isHexColor(v)) update({ color: v.toLowerCase() });
              }}
            />
          </div>
        </div>
      </div>

      <div className="card grid-2">
        <div className="field">
          <div className="field__label">Тип профиля</div>
          <div className="segmented">
            <button className={draft.kind === "work" ? "is-current" : ""} onClick={() => update({ kind: "work" })}>
              💼 Работа
            </button>
            <button className={draft.kind === "gaming" ? "is-current" : ""} onClick={() => update({ kind: "gaming" })}>
              🎮 Игры
            </button>
          </div>
        </div>
        <div className="field">
          <div className="field__label">Тема Windows</div>
          <div className="segmented">
            <button className={draft.theme === "dark" ? "is-current" : ""} onClick={() => update({ theme: "dark" })}>
              <Icon name="moon" size={14} /> Тёмная
            </button>
            <button className={draft.theme === "light" ? "is-current" : ""} onClick={() => update({ theme: "light" })}>
              <Icon name="sun" size={14} /> Светлая
            </button>
          </div>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <div className="field__label">Горячая клавиша профиля</div>
          <HotkeyInput value={draft.hotkey} onChange={(v) => update({ hotkey: v })} placeholder="Не задана" />
          <div className="field__hint">Переключает на этот профиль из любого места системы. Кликните и нажмите сочетание; Backspace — очистить.</div>
        </div>
      </div>

      <div className="card">
        <div className="field__label">Когда уходите из профиля</div>
        <div className="radio-cards">
          {LEAVE_OPTIONS.map((o) => (
            <label key={o.value} className={`radio-card${draft.onLeave === o.value ? " is-current" : ""}`}>
              <input type="radio" name="onLeave" checked={draft.onLeave === o.value} onChange={() => update({ onLeave: o.value })} />
              <span className="radio-card__mark" />
              <span>
                <span className="radio-card__title">{o.title}</span>
                <span className="radio-card__text">{o.text}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
