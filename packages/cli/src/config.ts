/**
 * `layerhop login` storage: the API key in `<config dir>/config.json`, file mode 600 in a 700
 * directory. Config dir: LAYERHOP_CONFIG_DIR, else $XDG_CONFIG_HOME/layerhop, else ~/.config/layerhop
 * (%APPDATA%\layerhop on Windows). `--api-key` and LAYERHOP_API_KEY always win over the stored key.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface StoredConfig {
  apiKey?: string;
  /** Set when `login` was given --api-url / LAYERHOP_API_URL (e.g. the local mock). */
  apiUrl?: string;
}

export const API_KEY_FORMAT = /^lh_(live|test)_[A-Za-z0-9]{16,128}$/;

export function configDir(env: Record<string, string | undefined>): string | undefined {
  if (env.LAYERHOP_CONFIG_DIR) return env.LAYERHOP_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "layerhop");
  if (env.APPDATA && !env.HOME) return join(env.APPDATA, "layerhop");
  if (env.HOME) return join(env.HOME, ".config", "layerhop");
  return undefined;
}

export function configPath(env: Record<string, string | undefined>): string | undefined {
  const dir = configDir(env);
  return dir ? join(dir, "config.json") : undefined;
}

/** The stored config, or {} when there is none (or it can't be read). Never throws. */
export function readConfig(env: Record<string, string | undefined>): StoredConfig {
  const file = configPath(env);
  if (!file || !existsSync(file)) return {};
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as StoredConfig;
    return v && typeof v === "object" ? { apiKey: typeof v.apiKey === "string" ? v.apiKey : undefined, apiUrl: typeof v.apiUrl === "string" ? v.apiUrl : undefined } : {};
  } catch {
    return {};
  }
}

/** Writes the config readable by the current user only. Returns the file path. */
export function writeConfig(env: Record<string, string | undefined>, cfg: StoredConfig): string {
  const dir = configDir(env);
  if (!dir) throw new Error("No config directory: set HOME, XDG_CONFIG_HOME or LAYERHOP_CONFIG_DIR");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "config.json");
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync keeps the mode of an existing file: tighten it explicitly.
  chmodSync(file, 0o600);
  return file;
}

/** Deletes the stored config. Returns whether there was one. */
export function removeConfig(env: Record<string, string | undefined>): boolean {
  const file = configPath(env);
  if (!file || !existsSync(file)) return false;
  rmSync(file);
  return true;
}

/** `lh_test_ab12…wxyz`: enough to recognise a key without printing it. */
export function maskKey(key: string): string {
  const m = /^(lh_(?:live|test)_)(.*)$/.exec(key);
  if (!m) return "****";
  const rest = m[2]!;
  return `${m[1]}${rest.slice(0, 4)}…${rest.slice(-4)}`;
}
