/**
 * Loads the repo-root .env. Import this FIRST in any Celo entrypoint script —
 * budget.ts and chain.ts read process.env at module load, and ESM evaluates
 * imports in order, so this must come before them.
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

dotenv.config({
  path: join(dirname(fileURLToPath(import.meta.url)), "../../../../.env"),
});
