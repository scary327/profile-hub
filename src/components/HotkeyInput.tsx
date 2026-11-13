import { useEffect, useRef, useState } from "react";
import { hotkeyParts, parseHotkey } from "../lib/hotkey";
import { Icon } from "./Icon";

interface Props {
  value: string | null;
  onChange: (v: string | null) => void;
  allowClear?: boolean;
  placeholder?: string;
}

/** Поле-записыватель хоткея: кликнуть и нажать сочетание. Esc — отмена, Backspace — очистить. */
export function HotkeyInput({ value, onChange, allowClear = true, placeholder = "Не задано" }: Props) {
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
      if (plain && e.key === "Escape") {
        setRecording(false);
        ref.current?.blur();
        return;
      }
      if (plain && (e.key === "Backspace" || e.key === "Delete")) {
        if (allowClear) onChange(null);
        setRecording(false);
        ref.current?.blur();
        return;
      }
      const r = parseHotkey(e);
      if (r.combo) {
        onChange(r.combo);
        setRecording(false);
        ref.current?.blur();
      } else {
        setPreview(r.preview);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) setPreview("");
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [recording, allowClear, onChange]);

  const parts = hotkeyParts(value);

  return (
    <div className="hotkey">
      <div
        ref={ref}
        tabIndex={0}
        role="button"
        data-hotkey-recorder="true"
        className={`hotkey__field${recording ? " is-recording" : ""}`}
        onFocus={() => {
          setPreview("");
          setRecording(true);
        }}
        onBlur={() => setRecording(false)}
        onMouseDown={(e) => {
          if (recording) {
            e.preventDefault();
          }
        }}
      >
        {recording ? (
          <span className="hotkey__recording">
            <span className="hotkey__dot" />
            {preview || "Нажмите сочетание…"}
          </span>
        ) : parts.length ? (
          <span className="kbd-row">
            {parts.map((p, i) => (
              <kbd key={i} className="kbd">
                {p}
              </kbd>
            ))}
          </span>
        ) : (
          <span className="hotkey__placeholder">{placeholder}</span>
        )}
      </div>
      {allowClear && value && !recording && (
        <button type="button" className="icon-btn" title="Очистить" onClick={() => onChange(null)}>
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}
