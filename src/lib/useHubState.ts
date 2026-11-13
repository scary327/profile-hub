import { useCallback, useEffect, useState } from "react";
import { api, onStateChanged, type HubState } from "../api";
import { errorMessage } from "./errors";

export interface HubStateHook {
  state: HubState | null;
  error: string | null;
  setState: (s: HubState) => void;
  reload: () => Promise<void>;
}

/** Загружает HubState и держит его свежим через событие "state-changed". */
export function useHubState(): HubStateHook {
  const [state, setState] = useState<HubState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setState(await api.getState());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void reload();
    onStateChanged((s) => {
      if (!disposed) setState(s);
    })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      })
      .catch(() => {
        /* события недоступны — живём на ручных обновлениях */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [reload]);

  return { state, error, setState, reload };
}
