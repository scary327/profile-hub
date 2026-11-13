import type { ProfileKind } from "../api";
import { Dialog } from "../components/Dialog";

export function NewProfileDialog({ onPick, onClose }: { onPick: (k: ProfileKind) => void; onClose: () => void }) {
  return (
    <Dialog
      title="Новый профиль"
      onClose={onClose}
      width={520}
      actions={
        <button className="btn btn--ghost" onClick={onClose}>
          Отмена
        </button>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Какой это будет профиль? Тип можно поменять позже.
      </p>
      <div className="kind-pick">
        <button className="kind-pick__card" data-autofocus onClick={() => onPick("work")}>
          <span className="kind-pick__emoji">💼</span>
          <span className="kind-pick__title">Работа</span>
          <span className="kind-pick__text">Свои браузеры, проекты и приложения для конкретной работы или клиента.</span>
        </button>
        <button className="kind-pick__card kind-pick__card--gaming" onClick={() => onPick("gaming")}>
          <span className="kind-pick__emoji">🎮</span>
          <span className="kind-pick__title">Игры</span>
          <span className="kind-pick__text">Отдохнуть после работы: лаунчеры, игровой режим, ничего рабочего.</span>
        </button>
      </div>
    </Dialog>
  );
}
