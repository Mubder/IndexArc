import type { RewriteStyle } from "../../types";
import type { getTranslation } from "../../utils/i18n";

export const REWRITE_STYLES: RewriteStyle[] = ["professional", "casual", "human", "technical", "concise", "formal"];
export const REWRITE_STYLE_KEYS: Record<RewriteStyle, Parameters<typeof getTranslation>[1]> = {
  professional: "rewrite_style_professional",
  casual: "rewrite_style_casual",
  human: "rewrite_style_human",
  technical: "rewrite_style_technical",
  concise: "rewrite_style_concise",
  formal: "rewrite_style_formal",
};

export const HIGHLIGHT_COLORS = [
  { hex: "#fef08a", key: "highlight_yellow" },
  { hex: "#86efac", key: "highlight_green" },
  { hex: "#93c5fd", key: "highlight_blue" },
  { hex: "#fca5a5", key: "highlight_red" },
  { hex: "#d8b4fe", key: "highlight_purple" },
];

export const TEXT_COLORS = [
  { hex: "#ffffff", key: "text_color_white" },
  { hex: "#f87171", key: "text_color_red" },
  { hex: "#fb923c", key: "text_color_orange" },
  { hex: "#facc15", key: "text_color_yellow" },
  { hex: "#4ade80", key: "text_color_green" },
  { hex: "#38bdf8", key: "text_color_blue" },
  { hex: "#c084fc", key: "text_color_purple" },
];
