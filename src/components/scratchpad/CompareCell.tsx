import type { CompareSide } from "../../lib/noteDiff";

/** One half of a compare-view row. Red tint = only in the left note,
 *  green tint = only in the right note; "changed" rows carry word-level
 *  highlights. The empty opposite half keeps the two columns aligned. */
export function CompareCell({
  side,
  variant,
  dir,
}: {
  side: CompareSide | null;
  variant: "left" | "right";
  dir: "ltr" | "rtl";
}) {
  if (!side) {
    return (
      <div
        className="px-3 py-[3px] min-h-[26px] text-xs leading-relaxed"
        style={{ background: "rgba(255,255,255,0.015)" }}
      />
    );
  }
  const tone =
    side.kind === "equal"
      ? "transparent"
      : side.kind === "changed"
        ? variant === "left" ? "rgba(248,113,113,0.08)" : "rgba(52,211,153,0.08)"
        : variant === "left" ? "rgba(248,113,113,0.18)" : "rgba(52,211,153,0.18)";
  const gutter =
    side.kind === "equal" ? "transparent" : variant === "left" ? "#f87171" : "#34d399";
  return (
    <div
      dir={dir}
      className="px-3 py-[3px] min-h-[26px] text-xs leading-relaxed whitespace-pre-wrap break-words"
      style={{
        background: tone,
        borderInlineStart: `2px solid ${gutter}`,
        color: side.kind === "equal" ? "var(--text-muted)" : "var(--text)",
      }}
    >
      {side.kind === "changed" && side.tokens ? (
        side.tokens.map((tok, i) =>
          tok.type === "equal" ? (
            <span key={i}>{tok.text}</span>
          ) : (
            <span
              key={i}
              style={{
                background:
                  tok.type === "delete" ? "rgba(248,113,113,0.4)" : "rgba(52,211,153,0.4)",
                borderRadius: 3,
                color: "#fff",
              }}
            >
              {tok.text}
            </span>
          )
        )
      ) : (
        side.text || "\u00a0"
      )}
    </div>
  );
}
