import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertNodeProductionConfig } from "../lib/node-production-config.mjs";

delete process.env.NODE_CONFIG_VALIDATED;

try {
  assertNodeProductionConfig(process.env);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Production configuration validation failed.",
  );
  process.exit(1);
}

process.env.DEPLOY_TARGET = "node";
process.env.NODE_CONFIG_VALIDATED = "1";

const packagedServer = fileURLToPath(new URL("../server.js", import.meta.url));
const localBuildServer = resolve(process.cwd(), "dist/standalone/server.js");
const serverPath = existsSync(packagedServer) ? packagedServer : localBuildServer;

if (!existsSync(serverPath)) {
  console.error(
    "Node standalone server is missing. Run `npm run build:node` before starting it.",
  );
  process.exit(1);
}

await import(pathToFileURL(serverPath).href);
