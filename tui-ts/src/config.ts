import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import {
  ALL_COLUMNS,
  type ColumnId,
  DEFAULT_COLUMNS,
} from "./components/SessionList.js";
import { DEFAULT_DB_PATH } from "./db.js";
import { readOpenCodeTheme } from "./theme.js";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const CONFIG_PATHS = [
  join(CONFIG_DIR, "pulse.jsonc"),
  join(CONFIG_DIR, "pulse.json"),
];

export interface PulseConfig {
  columns: ColumnId[];
  theme: string;
  dbPath: string;
  debug: boolean;
}

interface FileConfig {
  columns?: string | string[];
  theme?: string;
  dbPath?: string;
  debug?: boolean;
}

export function parseConfigContent(content: string, filePath = "<input>"): FileConfig {
  const errors: ParseError[] = [];
  const result = parseJsonc(content, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const messages = errors.map(e => `${printParseErrorCode(e.error)} at offset ${e.offset}`).join(", ");
    throw new Error(`Failed to parse ${filePath}: ${messages}`);
  }
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error(`Expected object in ${filePath}, got ${Array.isArray(result) ? "array" : typeof result}`);
  }
  return result as FileConfig;
}

function loadFileConfig(): FileConfig {
  for (const configPath of CONFIG_PATHS) {
    if (!existsSync(configPath)) continue;
    const content = readFileSync(configPath, "utf-8");
    return parseConfigContent(content, configPath);
  }
  return {};
}

function parseColumns(value: unknown): ColumnId[] | null {
  if (!value) return null;

  if (Array.isArray(value)) {
    const parsed = value.filter(
      (c): c is ColumnId =>
        typeof c === "string" && ALL_COLUMNS.includes(c as ColumnId),
    );
    return parsed.length > 0 ? parsed : null;
  }

  if (typeof value === "string") {
    const parsed = value
      .split(",")
      .map((s) => s.trim())
      .filter((c): c is ColumnId => ALL_COLUMNS.includes(c as ColumnId));
    return parsed.length > 0 ? parsed : null;
  }

  return null;
}

export function resolveConfig(cliArgs: {
  columns?: string;
  theme?: string;
  "db-path"?: string;
  debug?: boolean;
}): PulseConfig {
  const fileConfig = loadFileConfig();

  // Precedence: CLI > env > config file > auto-detect > defaults
  const columns =
    parseColumns(cliArgs.columns) ||
    parseColumns(process.env.PULSE_COLUMNS) ||
    parseColumns(fileConfig.columns) ||
    DEFAULT_COLUMNS;

  const theme =
    cliArgs.theme ||
    process.env.PULSE_THEME ||
    fileConfig.theme ||
    readOpenCodeTheme() ||
    "opencode";

  const dbPath =
    cliArgs["db-path"] ||
    process.env.PULSE_DB_PATH ||
    fileConfig.dbPath ||
    DEFAULT_DB_PATH;

  const debug = cliArgs.debug ??
    (process.env.PULSE_DEBUG === "true" || process.env.PULSE_DEBUG === "1" || fileConfig.debug === true);

  return { columns, theme, dbPath, debug };
}
