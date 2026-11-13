import { useState, type FormEvent } from "react";
import { api, type HubState } from "../../api";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toasts";
import type { TabProps } from "../ProfileEditor";
import { USERNAME_MAX, accountInfo, profileBySid, suggestUsername, validateUsername } from "../profileUtils";

type Mode = "create" | "existing" | null;

export function AccountTab({ draft, saved, state, onState }: TabProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [mode, setMode] = useState<Mode>(null);

  const run = async (fn: () => Promise<HubState>, ok: string, fail: string) => {
    setBusy(true);
    try {
      onState(await fn());
      toast.show({ kind: "success", title: ok, icon: saved?.icon });
      return true;
    } catch (e) {
      toast.error(e, fail);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const account = saved?.windowsUser ?? null;

  if (saved && account) {
    const { status, user } = accountInfo(state, saved);
    const missing = !user;
    return (
      <div className="stack">
        <div className="card">
          <div className="acc">
            <span className="acc__avatar">
              <Icon name="user" size={22} />
            </span>
            <div className="acc__main">
              <div className="acc__name">
                <span className="mono">{account.username}</span>
                {user?.fullName && user.fullName !== account.username && <span className="muted"> · {user.fullName}</span>}
              </div>
              <div className="acc__chips">
                {status === "current" && (
                  <span className="chip-status chip-status--ok">
                    <span className="live-dot" /> Вы сейчас здесь
                  </span>
                )}
                {status === "loggedIn" && (
                  <span className="chip-status">
                    <span className="live-dot live-dot--muted" /> Сеанс открыт в фоне
                  </span>
                )}
                {status === "linked" && !missing && <span className="chip-status">🔒 Не в системе — вход по PIN/паролю</span>}
                {missing && <span className="chip-status chip-status--warn">Учётка не найдена в Windows</span>}
              </div>
            </div>
            <button className="btn" disabled={busy} onClick={() => setConfirmUnlink(true)}>
              <Icon name="unlink" size={14} /> Отвязать
            </button>
          </div>
          <div className="field__hint" style={{ marginTop: 14 }}>
            Профиль живёт в своей учётке Windows: браузеры, файлы, панель задач и автозагрузка здесь не пересекаются с
            другими профилями. Переключение идёт через экран входа Windows.
          </div>
          {missing && (
            <div className="field__hint field__hint--warn">
              Пользователя с таким SID больше нет в системе. Отвяжите его и создайте или выберите учётку заново.
            </div>
          )}
        </div>

        {confirmUnlink && (
          <Dialog
            title={`Отвязать учётку ${account.username}?`}
            icon="🔓"
            onClose={() => setConfirmUnlink(false)}
            actions={
              <>
                <button className="btn btn--ghost" data-autofocus onClick={() => setConfirmUnlink(false)}>
                  Отмена
                </button>
                <button
                  className="btn btn--danger-solid"
                  onClick={async () => {
                    setConfirmUnlink(false);
                    await run(() => api.unlinkWindowsUser(saved.id), "Учётка отвязана", "Не удалось отвязать учётку");
                  }}
                >
                  Отвязать
                </button>
              </>
            }
          >
            <p style={{ marginTop: 0 }}>
              Сама учётка Windows и её файлы останутся — профиль просто перестанет на неё ссылаться. Переключиться в
              профиль можно будет только после новой привязки.
            </p>
            {status === "current" && (
              <div className="callout callout--danger">
                Это учётка, в которой вы сейчас. После отвязки хаб предложит привязать её к какому-нибудь профилю.
              </div>
            )}
          </Dialog>
        )}
      </div>
    );
  }

  // ---------- у профиля нет учётки ----------
  const cu = state.currentUser;
  const currentOwner = state.currentProfileId ? state.config.profiles.find((p) => p.id === state.currentProfileId) : null;
  const currentTaken = !!currentOwner && currentOwner.id !== saved?.id;
  const candidates = state.windowsUsers.filter((u) => u.enabled && !profileBySid(state.config.profiles, u.sid, saved?.id));

  return (
    <div className="stack">
      <div className="callout">
        <Icon name="user" size={16} />
        <div>
          Для полной изоляции профилю нужна своя учётка Windows: свои браузеры, файлы и панель задач, ничего общего с
          другими профилями. Создайте новую или привяжите существующую.
        </div>
      </div>

      {!saved && (
        <div className="field__hint field__hint--warn" style={{ marginTop: 0 }}>
          Сначала создайте профиль кнопкой «Создать» выше — потом здесь можно будет завести для него учётку.
        </div>
      )}

      <div className="acc-actions">
        <button
          className={`acc-action${mode === "create" ? " is-current" : ""}`}
          disabled={!saved || busy}
          onClick={() => setMode(mode === "create" ? null : "create")}
        >
          <span className="acc-action__icon">✨</span>
          <span className="acc-action__title">Создать учётку Windows</span>
          <span className="acc-action__text">Новый пользователь только для этого профиля</span>
        </button>

        {currentTaken ? (
          <div className="acc-action is-static">
            <span className="acc-action__icon">👤</span>
            <span className="acc-action__title">
              Текущая учётка (<span className="mono">{cu.username}</span>)
            </span>
            <span className="acc-action__text">
              Уже привязана к профилю «{currentOwner?.icon} {currentOwner?.name}»
            </span>
          </div>
        ) : (
          <button
            className="acc-action"
            disabled={!saved || busy}
            onClick={() =>
              saved && void run(() => api.linkCurrentUser(saved.id), `Учётка ${cu.username} привязана`, "Не удалось привязать учётку")
            }
          >
            <span className="acc-action__icon">👤</span>
            <span className="acc-action__title">
              Использовать текущую (<span className="mono">{cu.username}</span>)
            </span>
            <span className="acc-action__text">Профилем станет учётка, в которой вы сейчас</span>
          </button>
        )}

        <button
          className={`acc-action${mode === "existing" ? " is-current" : ""}`}
          disabled={!saved || busy || candidates.length === 0}
          onClick={() => setMode(mode === "existing" ? null : "existing")}
          title={candidates.length === 0 ? "Свободных учёток Windows нет" : undefined}
        >
          <span className="acc-action__icon">📋</span>
          <span className="acc-action__title">Выбрать существующую</span>
          <span className="acc-action__text">
            {candidates.length === 0 ? "Свободных учёток нет" : `Свободных учёток: ${candidates.length}`}
          </span>
        </button>
      </div>

      {saved && mode === "create" && (
        <CreateAccountForm
          key={saved.id}
          profileName={draft.name}
          state={state}
          busy={busy}
          onSubmit={(username, password) =>
            run(
              () => api.createWindowsUser(saved.id, username, password),
              `Учётка ${username} создана`,
              "Не удалось создать учётку",
            )
          }
          onCancel={() => setMode(null)}
        />
      )}

      {saved && mode === "existing" && candidates.length > 0 && (
        <ExistingPicker
          candidates={candidates}
          busy={busy}
          onPick={(sid, username) =>
            void run(() => api.linkWindowsUser(saved.id, sid), `Учётка ${username} привязана`, "Не удалось привязать учётку")
          }
        />
      )}
    </div>
  );
}

function CreateAccountForm({
  profileName,
  state,
  busy,
  onSubmit,
  onCancel,
}: {
  profileName: string;
  state: HubState;
  busy: boolean;
  onSubmit: (username: string, password: string | null) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState(() => suggestUsername(profileName));
  const [noPassword, setNoPassword] = useState(false);
  // пароль живёт только здесь и очищается сразу после отправки; нигде не логируется
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);

  const nameError = validateUsername(username, state.windowsUsers);
  const pwError = noPassword ? null : !password ? "Введите пароль" : password !== confirm ? "Пароли не совпадают" : null;
  const valid = !nameError && !pwError;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid || busy) return;
    const pw = noPassword ? null : password;
    setPassword("");
    setConfirm("");
    setTouched(false);
    await onSubmit(username, pw);
  };

  return (
    <form className="card acc-form" onSubmit={(e) => void submit(e)} autoComplete="off">
      <div className="card__title">Новая учётка Windows</div>

      <div className="field">
        <label className="field__label" htmlFor="acc-user">
          Имя пользователя
        </label>
        <input
          id="acc-user"
          className="input input--mono"
          value={username}
          maxLength={USERNAME_MAX}
          spellCheck={false}
          autoFocus
          onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
        />
        {nameError ? (
          <div className="field__hint field__hint--warn">{nameError}</div>
        ) : (
          <div className="field__hint">
            Латиница, цифры, «-» и «_», до {USERNAME_MAX} символов. Папка учётки: <span className="mono">C:\Users\{username}</span>
          </div>
        )}
      </div>

      <label className="check">
        <input type="checkbox" checked={noPassword} onChange={(e) => setNoPassword(e.target.checked)} />
        <span>
          Без пароля
          <span className="check__hint">Вход в профиль одним нажатием на плитку пользователя.</span>
        </span>
      </label>

      {noPassword ? (
        <div className="callout callout--danger" style={{ marginTop: 10 }}>
          Любой, кто сядет за компьютер, сможет войти в этот профиль — со всеми его браузерами, почтой и файлами.
        </div>
      ) : (
        <div className="grid-2 acc-form__pw">
          <div className="field">
            <label className="field__label" htmlFor="acc-pw">
              Пароль
            </label>
            <input
              id="acc-pw"
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="acc-pw2">
              Повторите пароль
            </label>
            <input
              id="acc-pw2"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <div className="field__hint" style={{ gridColumn: "1 / -1", marginTop: -6 }}>
            {touched && pwError ? (
              <span className="field__hint--warn">{pwError}</span>
            ) : (
              "PIN-код или Windows Hello можно настроить при первом входе в учётку."
            )}
          </div>
        </div>
      )}

      <div className="callout acc-form__note">
        <Icon name="sparkles" size={16} />
        <ul>
          <li>Windows попросит подтвердить создание пользователя (UAC).</li>
          <li>Первый вход в новую учётку занимает около минуты — Windows её подготавливает.</li>
          <li>В Steam, Epic и других лаунчерах там нужно будет один раз войти; игры заново скачивать не придётся.</li>
        </ul>
      </div>

      <div className="row row--end">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy || (touched && !valid) || !!nameError}>
          <Icon name="check" size={15} /> {busy ? "Создаём учётку…" : "Создать учётку"}
        </button>
      </div>
    </form>
  );
}

function ExistingPicker({
  candidates,
  busy,
  onPick,
}: {
  candidates: HubState["windowsUsers"];
  busy: boolean;
  onPick: (sid: string, username: string) => void;
}) {
  const [sid, setSid] = useState(candidates[0]?.sid ?? "");
  const chosen = candidates.find((u) => u.sid === sid) ?? candidates[0];
  return (
    <div className="card">
      <div className="card__title">Существующая учётка Windows</div>
      <div className="row">
        <select className="input" value={chosen?.sid ?? ""} onChange={(e) => setSid(e.target.value)} aria-label="Учётка Windows">
          {candidates.map((u) => (
            <option key={u.sid} value={u.sid}>
              {u.username}
              {u.fullName && u.fullName !== u.username ? ` (${u.fullName})` : ""}
              {u.isCurrent ? " — текущая" : u.loggedIn ? " — в системе" : ""}
            </option>
          ))}
        </select>
        <button className="btn btn--primary" disabled={busy || !chosen} onClick={() => chosen && onPick(chosen.sid, chosen.username)}>
          <Icon name="link" size={14} /> Привязать
        </button>
      </div>
      <div className="field__hint">Показаны включённые учётки, которые не привязаны к другим профилям.</div>
    </div>
  );
}
