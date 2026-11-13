import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Game, type GameSource, type HubState, type ManualGame } from "../api";
import { FallbackImage } from "../components/FallbackImage";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toasts";
import { SOURCE_LABEL, SOURCE_ORDER, sortGames } from "../lib/games";
import { hashGradient, initials } from "../lib/hash";
import { formatSize, relativeTime } from "../lib/time";
import { baseName } from "./profileUtils";

type Filter = "all" | GameSource;

export function LibraryPage({ state, onState }: { state: HubState; onState: (s: HubState) => void }) {
  const toast = useToast();
  const [games, setGames] = useState<Game[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      try {
        setGames(sortGames(await api.listGames(refresh)));
        if (refresh) toast.show({ kind: "success", title: "Библиотека обновлена" });
      } catch (e) {
        toast.error(e, "Не удалось получить список игр");
        setGames((g) => g ?? []);
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void load(false);
  }, [load, state.config.manualGames.length]);

  const sources = useMemo(() => SOURCE_ORDER.filter((s) => games?.some((g) => g.source === s)), [games]);
  const shown = (games ?? []).filter(
    (g) => (filter === "all" || g.source === filter) && g.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const play = async (g: Game) => {
    try {
      await api.launchGame(g.id);
      toast.show({ kind: "success", title: `Запускаем ${g.name}`, icon: "🎮" });
    } catch (e) {
      toast.error(e, `Не удалось запустить ${g.name}`);
    }
  };

  const enterGameMode = async () => {
    try {
      await api.enterGameMode();
    } catch (e) {
      toast.error(e, "Не удалось открыть игровой режим");
    }
  };

  const removeManual = async (m: ManualGame) => {
    try {
      onState(await api.removeManualGame(m.id));
      toast.show({ kind: "success", title: `«${m.name}» убрана из библиотеки` });
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="page page--wide">
      <div className="page__head">
        <div>
          <h1 className="page__title">Игровая библиотека</h1>
          <div className="muted">
            {games ? `${games.length} игр из ${sources.length || 0} источников` : "Сканируем лаунчеры…"}
          </div>
        </div>
        <div className="row">
          <button className="icon-btn icon-btn--lg" title="Пересканировать лаунчеры" onClick={() => void load(true)} disabled={loading}>
            <Icon name="refresh" size={17} className={loading ? "spin" : undefined} />
          </button>
          <button className="btn" onClick={() => setShowAdd((v) => !v)}>
            <Icon name="plus" size={15} /> Добавить игру
          </button>
          <button className="btn btn--switch" onClick={() => void enterGameMode()}>
            <Icon name="gamepad" size={17} /> Игровой режим
          </button>
        </div>
      </div>

      {showAdd && <AddGameForm onDone={(s) => (onState(s), setShowAdd(false))} onCancel={() => setShowAdd(false)} />}

      <div className="lib-toolbar">
        <div className="chips">
          <button className={`chip${filter === "all" ? " is-current" : ""}`} onClick={() => setFilter("all")}>
            Все
          </button>
          {sources.map((s) => (
            <button key={s} className={`chip${filter === s ? " is-current" : ""}`} onClick={() => setFilter(s)}>
              {SOURCE_LABEL[s]}
            </button>
          ))}
        </div>
        <input className="input input--sm lib-toolbar__search" placeholder="Поиск по играм…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {games === null ? (
        <div className="game-grid">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="gcard gcard--skeleton" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <div className="empty__icon">🕹️</div>
          <div className="empty__title">{games.length ? "Ничего не найдено" : "Игры не найдены"}</div>
          <div className="empty__text">
            {games.length ? "Попробуйте другой фильтр." : "Установите игры в Steam, Epic, GOG и др. или добавьте свою вручную."}
          </div>
        </div>
      ) : (
        <div className="game-grid">
          {shown.map((g) => (
            <div key={g.id} className="gcard" title={g.name}>
              <div className="gcard__art">
                <FallbackImage
                  candidates={g.covers}
                  className="gcard__img"
                  fallback={
                    <div className="gen-tile" style={{ background: hashGradient(g.name) }}>
                      <span>{initials(g.name)}</span>
                    </div>
                  }
                />
                <button className="gcard__play" onClick={() => void play(g)} title="Играть">
                  <Icon name="play" size={18} />
                </button>
                <span className="gcard__source">{SOURCE_LABEL[g.source]}</span>
              </div>
              <div className="gcard__name">{g.name}</div>
              <div className="gcard__meta">
                {[g.lastPlayed ? relativeTime(g.lastPlayed) : "не запускалась", formatSize(g.sizeBytes)].filter(Boolean).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      )}

      {state.config.manualGames.length > 0 && (
        <div className="card card--list" style={{ marginTop: 28 }}>
          <div className="list-head">
            <div className="list-head__title">Добавленные вручную</div>
          </div>
          {state.config.manualGames.map((m) => (
            <div key={m.id} className="list-row">
              <span className="proj-icon" style={{ background: hashGradient(m.name) }}>
                {initials(m.name)}
              </span>
              <div className="list-row__main">
                <div className="list-row__title">{m.name}</div>
                <div className="list-row__sub" title={m.exePath}>
                  {m.exePath}
                </div>
              </div>
              <button className="icon-btn icon-btn--danger" title="Убрать из библиотеки" onClick={() => void removeManual(m)}>
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddGameForm({ onDone, onCancel }: { onDone: (s: HubState) => void; onCancel: () => void }) {
  const toast = useToast();
  const [exePath, setExePath] = useState("");
  const [name, setName] = useState("");
  const [args, setArgs] = useState("");
  const [cover, setCover] = useState("");
  const [hero, setHero] = useState("");
  const [busy, setBusy] = useState(false);

  const pickExe = async () => {
    try {
      const f = await open({
        title: "Исполняемый файл игры",
        multiple: false,
        directory: false,
        filters: [{ name: "Программы и ярлыки", extensions: ["exe", "lnk", "bat", "url"] }],
      });
      if (typeof f === "string") {
        setExePath(f);
        if (!name.trim()) setName(baseName(f));
      }
    } catch (e) {
      toast.error(e);
    }
  };

  const pickImage = async (set: (v: string) => void) => {
    try {
      const f = await open({
        title: "Картинка",
        multiple: false,
        directory: false,
        filters: [{ name: "Изображения", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] }],
      });
      if (typeof f === "string") set(f);
    } catch (e) {
      toast.error(e);
    }
  };

  const submit = async () => {
    if (!exePath || !name.trim()) return;
    setBusy(true);
    try {
      const game: ManualGame = {
        id: crypto.randomUUID(),
        name: name.trim(),
        exePath,
        args: args.trim(),
        cover: cover.trim() || null,
        hero: hero.trim() || null,
      };
      onDone(await api.addManualGame(game));
      toast.show({ kind: "success", title: `«${game.name}» добавлена`, icon: "🎮" });
    } catch (e) {
      toast.error(e, "Не удалось добавить игру");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card add-game"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="add-game__preview">
        <FallbackImage
          candidates={[cover]}
          className="gcard__img"
          fallback={
            <div className="gen-tile" style={{ background: hashGradient(name || "?") }}>
              <span>{initials(name || "?")}</span>
            </div>
          }
        />
      </div>
      <div className="add-game__fields">
        <div className="card__title">Своя игра</div>
        <div className="row">
          <button type="button" className="btn" onClick={() => void pickExe()}>
            <Icon name="folder" size={15} /> Выбрать exe…
          </button>
          <div className="path-line" title={exePath}>
            {exePath || <span className="muted">Файл не выбран</span>}
          </div>
        </div>
        <div className="grid-2">
          <input className="input" placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input input--mono" placeholder="Аргументы (необязательно)" value={args} onChange={(e) => setArgs(e.target.value)} />
        </div>
        <div className="grid-2">
          <div className="input-group">
            <input className="input" placeholder="Обложка: URL или файл" value={cover} onChange={(e) => setCover(e.target.value)} />
            <button type="button" className="btn" title="Выбрать файл" onClick={() => void pickImage(setCover)}>
              <Icon name="image" size={15} />
            </button>
          </div>
          <div className="input-group">
            <input className="input" placeholder="Фон (hero): URL или файл" value={hero} onChange={(e) => setHero(e.target.value)} />
            <button type="button" className="btn" title="Выбрать файл" onClick={() => void pickImage(setHero)}>
              <Icon name="image" size={15} />
            </button>
          </div>
        </div>
        <div className="row row--end">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary" disabled={!exePath || !name.trim() || busy}>
            <Icon name="plus" size={15} /> Добавить
          </button>
        </div>
      </div>
    </form>
  );
}
