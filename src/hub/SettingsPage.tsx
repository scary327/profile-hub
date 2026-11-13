import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { api, type HubState, type Settings } from "../api";
import { Dialog } from "../components/Dialog";
import { HotkeyInput } from "../components/HotkeyInput";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toasts";
import { Toggle } from "../components/Toggle";

export function SettingsPage({ state, onState }: { state: HubState; onState: (s: HubState) => void }) {
  const toast = useToast();
  const original = state.config.settings;
  const [draft, setDraft] = useState<Settings>(original);
  const [base, setBase] = useState<Settings>(original);
  const [saving, setSaving] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  // настройки поменялись снаружи, а у нас нет правок — подтягиваем
  if (!dirty && JSON.stringify(original) !== JSON.stringify(base)) {
    setDraft(original);
    setBase(original);
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    if (!draft.hubHotkey || !draft.gameHotkey) {
      toast.show({ kind: "error", title: "Задайте оба хоткея" });
      return;
    }
    setSaving(true);
    try {
      const res = await api.saveSettings(draft);
      onState(res);
      setDraft(res.config.settings);
      setBase(res.config.settings);
      toast.show({ kind: "success", title: "Настройки сохранены" });
    } catch (e) {
      toast.error(e, "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  };

  const pickRoot = async () => {
    try {
      const dir = await open({ title: "Корень данных профилей", directory: true, multiple: false, defaultPath: draft.profilesRoot || undefined });
      if (typeof dir === "string") set("profilesRoot", dir);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Настройки</h1>
          <div className="muted">Общие параметры Profile Hub</div>
        </div>
        <div className="row">
          {dirty && (
            <button className="btn btn--ghost" onClick={() => setDraft(base)}>
              Отменить
            </button>
          )}
          <button className={`btn${dirty ? " btn--primary" : ""}`} disabled={!dirty || saving} onClick={() => void save()}>
            <Icon name="check" size={15} /> {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card__title">Горячие клавиши</div>
          {state.busyHotkeys.length > 0 && (
            <div className="setting__sub" style={{ color: "#ff6b6b", marginBottom: 8 }}>
              Заняты другой программой: {state.busyHotkeys.join(", ")}. Выберите другое сочетание.
            </div>
          )}
          <div className="setting">
            <div className="setting__text">
              <div className="setting__title">Открыть хаб</div>
              <div className="setting__sub">Показывает это окно поверх всего</div>
            </div>
            <HotkeyInput value={draft.hubHotkey} allowClear={false} onChange={(v) => v && set("hubHotkey", v)} />
          </div>
          <div className="setting">
            <div className="setting__text">
              <div className="setting__title">Игровой режим</div>
              <div className="setting__sub">Полноэкранная библиотека игр, управление геймпадом</div>
            </div>
            <HotkeyInput value={draft.gameHotkey} allowClear={false} onChange={(v) => v && set("gameHotkey", v)} />
          </div>
        </div>

        <div className="card">
          <div className="card__title">Данные профилей</div>
          <div className="setting">
            <div className="setting__text">
              <div className="setting__title">Корневая папка</div>
              <div className="setting__sub">Здесь хранятся данные браузеров и проекты профилей по умолчанию</div>
            </div>
          </div>
          <div className="row">
            <div className="path-line path-line--box" title={draft.profilesRoot}>
              <Icon name="folder" size={15} />
              <span>{draft.profilesRoot}</span>
            </div>
            <button className="btn" onClick={() => void pickRoot()}>
              Изменить
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card__title">Система</div>
          <div className="setting">
            <div className="setting__text">
              <div className="setting__title">Запускать вместе с Windows</div>
              <div className="setting__sub">Хаб стартует свёрнутым в трей</div>
            </div>
            <Toggle checked={draft.launchOnStartup} onChange={(v) => set("launchOnStartup", v)} label="Автозапуск" />
          </div>
          <div className="setting">
            <div className="setting__text">
              <div className="setting__title">Менять тему Windows</div>
              <div className="setting__sub">При переключении применять светлую или тёмную тему профиля</div>
            </div>
            <Toggle checked={draft.applyWindowsTheme} onChange={(v) => set("applyWindowsTheme", v)} label="Тема Windows" />
          </div>
        </div>

        <div className="card card--row">
          <div>
            <div className="setting__title">Выход из приложения</div>
            <div className="setting__sub">Глобальные хоткеи перестанут работать до следующего запуска</div>
          </div>
          <button className="btn btn--danger" onClick={() => setConfirmQuit(true)}>
            <Icon name="power" size={15} /> Выйти из приложения
          </button>
        </div>
      </div>

      {confirmQuit && (
        <Dialog
          title="Выйти из Profile Hub?"
          icon="👋"
          onClose={() => setConfirmQuit(false)}
          actions={
            <>
              <button className="btn btn--ghost" data-autofocus onClick={() => setConfirmQuit(false)}>
                Отмена
              </button>
              <button className="btn btn--danger-solid" onClick={() => void api.quitApp().catch((e) => toast.error(e))}>
                Выйти
              </button>
            </>
          }
        >
          Приложение закроется полностью, в трее его не останется.
        </Dialog>
      )}
    </div>
  );
}
