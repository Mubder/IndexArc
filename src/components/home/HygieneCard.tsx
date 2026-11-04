import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import type { TranslationDict } from "../../utils/i18n";

type T = (key: keyof TranslationDict) => string;

interface Item {
  id: string;
  name: string;
  type: string;
  state: "expired" | "expiring" | "rotation_due";
  due_at: string;
}

/** Home: secrets that expired, expire soon, or are due for rotation (R6.3). */
export function HygieneCard({ t, refreshKey }: { t: T; refreshKey?: unknown }) {
  const [data, setData] = useState<{ items: Item[]; tracked: number } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/entries/hygiene")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setData(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (!data) return null;
  const label: Record<Item["state"], { text: string; color: string }> = {
    expired: { text: t("hyg_state_expired"), color: "var(--danger)" },
    rotation_due: { text: t("hyg_state_rotation_due"), color: "var(--amber)" },
    expiring: { text: t("hyg_state_expiring"), color: "var(--amber)" },
  };

  return (
    <div className="rounded-xl p-4 space-y-2" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--cyan)" }}>
        <CalendarClock className="w-3.5 h-3.5" /> {t("hyg_card_title")}
      </h3>
      {data.items.length === 0 ? (
        <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>
          {data.tracked ? t("hyg_all_good") : t("hyg_none_tracked")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {data.items.slice(0, 6).map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate" style={{ color: "var(--text)" }}>{i.name}</span>
              <span className="shrink-0 text-[10px] font-semibold" style={{ color: label[i.state].color }}>
                {label[i.state].text} · {new Date(i.due_at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
