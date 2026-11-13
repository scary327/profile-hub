function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «только что», «5 минут назад», «вчера», «3 дня назад», «2 месяца назад». */
export function relativeTime(unixSeconds: number | null | undefined, now = Date.now()): string {
  if (!unixSeconds) return "";
  const date = new Date(unixSeconds * 1000);
  const diff = Math.max(0, now - date.getTime()) / 1000;
  if (diff < 60) return "только что";
  const min = Math.floor(diff / 60);
  if (min < 60) return `${min} ${plural(min, "минуту", "минуты", "минут")} назад`;
  const hours = Math.floor(min / 60);

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  if (days === 1) return "вчера";
  if (days === 2) return "позавчера";
  if (days < 7) return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `${w} ${plural(w, "неделю", "недели", "недель")} назад`;
  }
  if (days < 365) {
    const m = Math.floor(days / 30);
    return `${m} ${plural(m, "месяц", "месяца", "месяцев")} назад`;
  }
  const y = Math.floor(days / 365);
  return `${y} ${plural(y, "год", "года", "лет")} назад`;
}

export function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)} ГБ`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} МБ`;
}

export function formatClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
