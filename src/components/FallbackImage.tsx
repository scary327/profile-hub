import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { imageSrc } from "../api";

interface Props {
  /** Кандидаты (URL или локальные пути) по приоритету. */
  candidates: readonly (string | null | undefined)[];
  alt?: string;
  className?: string;
  style?: CSSProperties;
  /** Что показать, если все кандидаты не загрузились. */
  fallback?: ReactNode;
  /** Сообщает итоговый src (или null, если ничего не загрузилось). */
  onResolved?: (src: string | null) => void;
}

function safeSrc(c: string): string | null {
  try {
    return imageSrc(c);
  } catch {
    return null;
  }
}

/**
 * Картинка, перебирающая кандидатов по onError.
 * Загруженная картинка получает data-loaded="true" — удобно для плавного появления в CSS.
 */
export function FallbackImage({ candidates, alt = "", className, style, fallback = null, onResolved }: Props) {
  const key = candidates.filter(Boolean).join("\n");
  const srcs = useMemo(
    () =>
      key
        .split("\n")
        .filter((c) => c.trim() !== "")
        .map(safeSrc)
        .filter((s): s is string => !!s),
    [key],
  );
  const [st, setSt] = useState({ key, index: 0 });
  const index = st.key === key ? st.index : 0;
  const exhausted = index >= srcs.length;

  useEffect(() => {
    if (exhausted) onResolved?.(null);
    // onResolved намеренно не в зависимостях — это колбэк-уведомление
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exhausted, key]);

  if (exhausted) return <>{fallback}</>;
  const src = srcs[index];
  return (
    <img
      key={src}
      src={src}
      alt={alt}
      className={className}
      style={style}
      draggable={false}
      decoding="async"
      onLoad={(e) => {
        e.currentTarget.dataset.loaded = "true";
        onResolved?.(src);
      }}
      onError={() => setSt({ key, index: index + 1 })}
    />
  );
}
