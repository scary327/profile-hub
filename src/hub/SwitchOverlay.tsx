import type { Profile } from "../api";
import { accentVars } from "./profileUtils";

export function SwitchOverlay({ profile }: { profile: Profile }) {
  return (
    <div className="switch-overlay" style={accentVars(profile.color)} role="status">
      <div className="switch-overlay__ring" />
      <div className="switch-overlay__icon">{profile.icon}</div>
      <div className="switch-overlay__label">Переключение на</div>
      <div className="switch-overlay__name">{profile.name}</div>
    </div>
  );
}
