import type { Profile } from "../api";
import { accentVars, leaveSignsOut } from "./profileUtils";

/** Переход в профиль другой учётки: Windows покажет экран входа, там нужно выбрать пользователя профиля. */
export function SwitchOverlay({ profile, from }: { profile: Profile; from: Profile | null }) {
  const username = profile.windowsUser?.username ?? "";
  const signOut = leaveSignsOut(from, profile);
  return (
    <div className="switch-overlay" style={accentVars(profile.color)} role="status">
      <div className="switch-overlay__ring" />
      <div className="switch-overlay__icon">{profile.icon}</div>
      <div className="switch-overlay__label">Переход к экрану входа…</div>
      <div className="switch-overlay__name">{profile.name}</div>
      <div className="switch-overlay__hint">
        Выберите пользователя <b>«{username}»</b> и войдите по PIN или паролю
      </div>
      <div className={`switch-overlay__leave${signOut ? " is-warn" : ""}`}>
        {signOut
          ? "Текущий сеанс будет завершён — несохранённая работа в нём закроется"
          : "Текущий сеанс останется в фоне — программы продолжат работать"}
      </div>
    </div>
  );
}
