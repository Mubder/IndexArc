import type { TranslationDict } from "../../utils/i18n";

export type TFn = (key: keyof TranslationDict) => string;
