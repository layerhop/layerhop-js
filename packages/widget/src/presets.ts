/**
 * Theme presets of the LayerHop embed (`preset` option). Mirrors apps/web/src/lib/embedPresets.ts;
 * a test in apps/web keeps the two in sync.
 *
 * Colors are hex without `#`. Every preset defines a dark and a light palette, so `theme=auto`
 * (and an explicit `theme`) keep working with any preset.
 */

export const COLOR_KEYS = [
  "accent",
  "accentText",
  "bg",
  "surface",
  "surfaceAlt",
  "text",
  "textMuted",
  "border",
  "success",
  "warning",
  "danger",
] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];
export type Palette = Record<ColorKey, string>;
export type ThemeMode = "dark" | "light";

/** The default LayerHop look; mirrors the tokens in apps/web/src/app/globals.css. */
export const BASE_PALETTES: Record<ThemeMode, Palette> = {
  dark: {
    accent: "c3f06b", accentText: "080a0d", bg: "090d15", surface: "121823", surfaceAlt: "19212f",
    text: "ebf1f9", textMuted: "9eadc2", border: "2e3a4d", success: "7ddec8", warning: "facc15", danger: "f87171",
  },
  light: {
    accent: "65a30d", accentText: "080a0d", bg: "f3f6f9", surface: "ffffff", surfaceAlt: "eff3f7",
    text: "0e141c", textMuted: "546070", border: "d0d8e2", success: "0d8076", warning: "a16207", danger: "c81e1e",
  },
};

export const PRESET_IDS = ["midnight", "paper", "lime", "ocean", "mono"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export interface Preset {
  label: string;
  description: string;
  /** Theme used when the embed URL has no `theme`. */
  defaultTheme: ThemeMode;
  dark: Palette;
  light: Palette;
}

export const PRESETS: Record<PresetId, Preset> = {
  midnight: {
    label: "Midnight",
    description: "Ink-blue surfaces with a violet accent.",
    defaultTheme: "dark",
    dark: {
      accent: "8b7cff", accentText: "0b0d1a", bg: "0b0d1a", surface: "13162b", surfaceAlt: "1c2040",
      text: "eef0ff", textMuted: "a3a8d4", border: "2c3160", success: "5eead4", warning: "fbbf24", danger: "fb7185",
    },
    light: {
      accent: "5b4bdb", accentText: "ffffff", bg: "eef0fb", surface: "ffffff", surfaceAlt: "f1f2fb",
      text: "15173a", textMuted: "5a5f8a", border: "d6d9f0", success: "0f766e", warning: "a16207", danger: "be123c",
    },
  },
  paper: {
    label: "Paper",
    description: "Quiet neutrals and an ink-black button.",
    defaultTheme: "light",
    dark: {
      accent: "f2f1ea", accentText: "161614", bg: "161614", surface: "1f1f1c", surfaceAlt: "2a2a26",
      text: "f2f1ea", textMuted: "a8a69a", border: "3b3b35", success: "7bc48f", warning: "e3b341", danger: "f28b82",
    },
    light: {
      accent: "1a1a17", accentText: "fffffe", bg: "f4f4f1", surface: "fffffe", surfaceAlt: "f1f1ec",
      text: "1a1a17", textMuted: "66655c", border: "dddcd3", success: "2f7d4f", warning: "9a6700", danger: "b42318",
    },
  },
  lime: {
    label: "Lime",
    description: "High-energy chartreuse on deep moss.",
    defaultTheme: "dark",
    dark: {
      accent: "bef264", accentText: "0a0f05", bg: "0a0f05", surface: "111a0a", surfaceAlt: "1a2610",
      text: "f2fbe6", textMuted: "a5b894", border: "2c3d1c", success: "86efac", warning: "fde047", danger: "fca5a5",
    },
    light: {
      accent: "4d7c0f", accentText: "ffffff", bg: "f4f9ec", surface: "ffffff", surfaceAlt: "eef5e2",
      text: "15200b", textMuted: "56664a", border: "d4e3bf", success: "15803d", warning: "a16207", danger: "b91c1c",
    },
  },
  ocean: {
    label: "Ocean",
    description: "Deep-water blues with a sky accent.",
    defaultTheme: "dark",
    dark: {
      accent: "38bdf8", accentText: "04121c", bg: "04121c", surface: "0a1d2b", surfaceAlt: "10293b",
      text: "e6f4fb", textMuted: "8fb1c4", border: "1d3d55", success: "2dd4bf", warning: "fbbf24", danger: "f87171",
    },
    light: {
      accent: "0369a1", accentText: "ffffff", bg: "eaf5fb", surface: "ffffff", surfaceAlt: "e8f2f8",
      text: "0b2233", textMuted: "4b6577", border: "c8dde9", success: "0f766e", warning: "a16207", danger: "c81e1e",
    },
  },
  mono: {
    label: "Mono",
    description: "Pure greyscale; color only for warnings.",
    defaultTheme: "dark",
    dark: {
      accent: "fafafa", accentText: "0a0a0a", bg: "0a0a0a", surface: "141414", surfaceAlt: "1f1f1f",
      text: "fafafa", textMuted: "a3a3a3", border: "333333", success: "d4d4d4", warning: "fbbf24", danger: "f87171",
    },
    light: {
      accent: "0a0a0a", accentText: "ffffff", bg: "f5f5f5", surface: "ffffff", surfaceAlt: "f2f2f2",
      text: "0a0a0a", textMuted: "616161", border: "dddddd", success: "404040", warning: "a16207", danger: "c81e1e",
    },
  },
};

export const FONT_IDS = ["inter", "system", "space-grotesk", "ibm-plex-sans", "dm-sans", "manrope"] as const;
export type FontId = (typeof FONT_IDS)[number];

export const FONTS: Record<FontId, { label: string; /** Google Fonts family, loaded only when requested. */ google?: string }> = {
  inter: { label: "Inter" },
  system: { label: "System UI" },
  "space-grotesk": { label: "Space Grotesk" },
  "ibm-plex-sans": { label: "IBM Plex Sans", google: "IBM+Plex+Sans:wght@400;500;600;700" },
  "dm-sans": { label: "DM Sans", google: "DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700" },
  manrope: { label: "Manrope", google: "Manrope:wght@400;500;600;700" },
};
