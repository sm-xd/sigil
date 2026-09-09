// Loads the repo-root .env before any module reads process.env (ESM imports are hoisted, so this
// must be the first import of every entrypoint). Existing process env always wins.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
