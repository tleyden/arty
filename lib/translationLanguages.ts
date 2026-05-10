export type TranslationLanguage = {
  code: string;
  name: string;
  flag: string;
};

export const TRANSLATION_OUTPUT_LANGUAGES: TranslationLanguage[] = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "pt", name: "Portuguese", flag: "🇧🇷" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ru", name: "Russian", flag: "🇷🇺" },
  { code: "zh", name: "Chinese", flag: "🇨🇳" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "id", name: "Indonesian", flag: "🇮🇩" },
  { code: "vi", name: "Vietnamese", flag: "🇻🇳" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
];

export const FEATURED_LANGUAGE_CODES = ["de", "en", "es"];

export const featuredLanguages = TRANSLATION_OUTPUT_LANGUAGES.filter((l) =>
  FEATURED_LANGUAGE_CODES.includes(l.code),
);

export const moreLanguages = TRANSLATION_OUTPUT_LANGUAGES.filter(
  (l) => !FEATURED_LANGUAGE_CODES.includes(l.code),
);
