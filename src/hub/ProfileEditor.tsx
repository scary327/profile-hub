import { useState } from "react";
import { api, type HubState, type Profile } from "../api";
import { Dialog } from "../components/Dialog";
import { Icon, type IconName } from "../components/Icon";
import { useToast } from "../components/Toasts";
import { hotkeyParts } from "../lib/hotkey";
import { AccountTab } from "./tabs/AccountTab";
import { AppsTab } from "./tabs/AppsTab";
import { BrowsersTab } from "./tabs/BrowsersTab";
import { GeneralTab } from "./tabs/GeneralTab";
import { ProjectsTab } from "./tabs/ProjectsTab";
import { WallpaperTab } from "./tabs/WallpaperTab";
import { KIND_LABEL, accentVars, accountInfo } from "./profileUtils";

export interface TabProps {
  draft: Profile;
  /** Сохранённая версия (null — профиль ещё не сохранён). */
  saved: Profile | null;
  state: HubState;
  /** Профиль учётки, в которой запущен хаб: запускать/открывать что-то можно только в нём. */
  isCurrent: boolean;
  update: (patch: Partial<Profile>) => void;
  onState: (s: HubState) => void;
}

type TabId = "account" | "general" | "wallpaper" | "browsers" | "projects" | "apps";

const TABS: Array<{ id: TabId; label: string; icon: IconName }> = [
  { id: "account", label: "Учётка", icon: "user" },
  { id: "general", label: "Общее", icon: "sliders" },
  { id: "wallpaper", label: "Обои", icon: "image" },
  { id: "browsers", label: "Браузеры", icon: "globe" },
  { id: "projects", label: "Проекты", icon: "code" },
  { id: "apps", label: "Приложения", icon: "app" },
];

interface Props {
  draft: Profile;
  saved: Profile | null;
  state: HubState;
  dirty: boolean;
  saving: boolean;
  isNew: boolean;
  /** Это профиль учётки, в которой запущен хаб. */
  isCurrent: boolean;
  isRunning: boolean;
  onChange: (patch: Partial<Profile>) => void;
  onSave: () => void;
  onRevert: () => void;
  onDelete: (deleteData: boolean) => Promise<void>;
  onSwitch: () => void;
  onState: (s: HubState) => void;
}

export function ProfileEditor(props: Props) {
  const { draft, saved, state, dirty, saving, isCurrent, isRunning, onChange, onSave, onRevert, onSwitch, onState } = props;
  const toast = useToast();
  const [tab, setTab] = useState<TabId>(saved?.windowsUser ? "general" : "account");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteData, setDeleteData] = useState(false);
  const [closing, setClosing] = useState(false);

  const closeAll = async () => {
    if (!saved) return;
    setClosing(true);
    try {
      onState(await api.closeProfileApps(saved.id));
      toast.show({ kind: "success", title: "Приложения профиля закрыты", icon: saved.icon });
    } catch (e) {
      toast.error(e, "Не удалось закрыть приложения");
    } finally {
      setClosing(false);
    }
  };

  const tabProps: TabProps = { draft, saved, state, isCurrent, update: onChange, onState };
  const hk = hotkeyParts(saved?.hotkey);
  const account = saved?.windowsUser ?? null;
  const accStatus = saved ? accountInfo(state, saved).status : "none";

  const switchTitle = !saved
    ? "Сначала сохраните профиль"
    : isCurrent
      ? "Вы уже в учётке этого профиля"
      : !account
        ? "Сначала создайте учётку — вкладка «Учётка»"
        : `Откроется экран входа Windows — выберите «${account.username}»`;

  return (
    <div className="editor" style={accentVars(draft.color)}>
      <section className="hero">
        <div className="hero__bg" />
        <div className="hero__icon">{draft.icon || "•"}</div>
        <div className="hero__info">
          <div className="hero__row">
            <h1 className="hero__name">{draft.name || "Без имени"}</h1>
            {dirty && (
              <span className="dirty-pill" title="Есть несохранённые изменения">
                <span className="dirty-pill__dot" /> не сохранено
              </span>
            )}
          </div>
          <div className="hero__meta">
            <span className={`badge badge--${draft.kind}`}>{KIND_LABEL[draft.kind]}</span>
            {!saved ? (
              <span className="hero__state">Новый профиль</span>
            ) : isCurrent ? (
              <span className="hero__state hero__state--active">
                <span className="live-dot" /> Вы сейчас здесь
              </span>
            ) : isRunning || accStatus === "loggedIn" ? (
              <span className="hero__state">
                <span className="live-dot live-dot--muted" /> Сеанс открыт в фоне
              </span>
            ) : account ? (
              <span className="hero__state">Не в системе</span>
            ) : (
              <span className="hero__state hero__state--warn">Нет учётки Windows</span>
            )}
            {account && (
              <span className="hero__state" title="Учётка Windows профиля">
                <Icon name="user" size={13} /> <span className="mono">{account.username}</span>
              </span>
            )}
            {hk.length > 0 && (
              <span className="kbd-row" title="Глобальный хоткей профиля">
                {hk.map((k, i) => (
                  <kbd key={i} className="kbd kbd--sm">
                    {k}
                  </kbd>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="hero__actions">
          <span title={switchTitle}>
            <button className="btn btn--switch" disabled={!saved || isCurrent || !account} onClick={onSwitch}>
              <Icon name="swap" size={17} />
              {isCurrent ? "Вы в этом профиле" : "Переключиться"}
            </button>
          </span>
        </div>
      </section>

      <div className="editor__toolbar">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab${tab === t.id ? " is-current" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </div>
        <div className="editor__toolbar-actions">
          {dirty && (
            <button className="btn btn--ghost" onClick={onRevert} disabled={saving}>
              {saved ? "Отменить" : "Не создавать"}
            </button>
          )}
          <button className={`btn${dirty ? " btn--primary" : ""}`} disabled={!dirty || saving} onClick={onSave} title="Ctrl+S">
            <Icon name="check" size={15} />
            {saving ? "Сохранение…" : saved ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>

      <div className="editor__content" key={tab}>
        {tab === "account" && <AccountTab {...tabProps} />}
        {tab === "general" && <GeneralTab {...tabProps} />}
        {tab === "wallpaper" && <WallpaperTab {...tabProps} />}
        {tab === "browsers" && <BrowsersTab {...tabProps} />}
        {tab === "projects" && <ProjectsTab {...tabProps} />}
        {tab === "apps" && <AppsTab {...tabProps} />}

        <div className="danger-zone">
          <div>
            <div className="danger-zone__title">Управление профилем</div>
            <div className="muted small">Закрыть всё, что запущено в профиле, или удалить его.</div>
          </div>
          <div className="danger-zone__actions">
            <button className="btn" disabled={!saved || closing} onClick={() => void closeAll()}>
              <Icon name="stop" size={12} />
              {closing ? "Закрываем…" : "Закрыть всё в профиле"}
            </button>
            <button
              className="btn btn--danger"
              onClick={() => {
                setDeleteData(false);
                setConfirmDelete(true);
              }}
            >
              <Icon name="trash" size={15} />
              {saved ? "Удалить профиль" : "Отменить создание"}
            </button>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <Dialog
          title={saved ? `Удалить профиль «${draft.name}»?` : "Отменить создание профиля?"}
          icon="🗑️"
          onClose={() => setConfirmDelete(false)}
          actions={
            <>
              <button className="btn btn--ghost" data-autofocus onClick={() => setConfirmDelete(false)}>
                Отмена
              </button>
              <button
                className="btn btn--danger-solid"
                onClick={async () => {
                  setConfirmDelete(false);
                  await props.onDelete(deleteData && !!account && !isCurrent);
                }}
              >
                {saved ? "Удалить" : "Отменить создание"}
              </button>
            </>
          }
        >
          {saved ? (
            <>
              <p style={{ marginTop: 0 }}>
                Профиль исчезнет из хаба.
                {account && " Без галочки ниже его учётка Windows останется — в неё по-прежнему можно войти."}
              </p>
              <label className={`check${!account || isCurrent ? " is-disabled" : ""}`}>
                <input
                  type="checkbox"
                  checked={deleteData && !!account && !isCurrent}
                  disabled={!account || isCurrent}
                  onChange={(e) => setDeleteData(e.target.checked)}
                />
                <span>
                  Удалить учётку Windows и все её файлы (необратимо)
                  <span className="check__hint">
                    {!account
                      ? "У профиля нет своей учётки Windows."
                      : isCurrent
                        ? "Нельзя удалить учётку, в которой вы сейчас."
                        : `Пользователь ${account.username} будет удалён вместе с папкой C:\\Users\\${account.username}. Windows запросит подтверждение (UAC).`}
                  </span>
                </span>
              </label>
              {deleteData && account && !isCurrent && (
                <div className="callout callout--danger">
                  Будут стёрты все файлы учётки <span className="mono">{account.username}</span>: документы, рабочий стол,
                  проекты (<span className="mono">{saved.projectsDir}</span>), логины, куки и история браузеров. Восстановить
                  их будет нельзя.
                </div>
              )}
            </>
          ) : (
            <p style={{ margin: 0 }}>Несохранённый профиль будет отброшен.</p>
          )}
        </Dialog>
      )}
    </div>
  );
}
