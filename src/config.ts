import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cameraHome, expandHome } from "./platform.js";

export type Loe = "low" | "medium" | "high" | "xhigh";
export interface Tier {
  model: string;
  reasoning: string;
}
export interface BackendConfig {
  tiers: Record<Loe, Tier>;
  defaults: Tier;
  fallbackModel: string;
}
export interface Config {
  dataDir: string;
  retryBudget: number;
  workerTimeoutS: number;
  backends: { codex: BackendConfig; claude: BackendConfig };
}

// Shipped defaults = v1's model ladders (spec §Config).
const DEFAULTS: Config = {
  dataDir: cameraHome(),
  retryBudget: 2,
  workerTimeoutS: 1800,
  backends: {
    codex: {
      tiers: {
        low: { model: "gpt-5.6-luna", reasoning: "high" },
        medium: { model: "gpt-5.6-terra", reasoning: "medium" },
        high: { model: "gpt-5.6-sol", reasoning: "high" },
        xhigh: { model: "gpt-5.6-sol", reasoning: "xhigh" },
      },
      defaults: { model: "gpt-5.6-terra", reasoning: "high" },
      fallbackModel: "gpt-5.6-terra",
    },
    claude: {
      tiers: {
        low: { model: "haiku", reasoning: "high" },
        medium: { model: "sonnet", reasoning: "medium" },
        high: { model: "opus", reasoning: "high" },
        xhigh: { model: "opus", reasoning: "xhigh" },
      },
      defaults: { model: "sonnet", reasoning: "high" },
      fallbackModel: "sonnet",
    },
  },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, over: unknown): T {
  if (!isObject(base) || !isObject(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = deepMerge((base as Record<string, unknown>)[k], v);
  }
  return out as T;
}

// Precedence: explicit tool args (handled at call sites) > config file > shipped defaults.
export function loadConfig(): Config {
  let user: unknown;
  try {
    user = JSON.parse(readFileSync(join(cameraHome(), "config.json"), "utf8"));
  } catch {
    user = {};
  }
  const cfg = deepMerge(structuredClone(DEFAULTS), user);
  // CAMERATA_HOME wins over config.dataDir; otherwise honor the config value.
  cfg.dataDir = process.env.CAMERATA_HOME ?? expandHome(cfg.dataDir);
  return cfg;
}
