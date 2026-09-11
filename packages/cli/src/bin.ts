#!/usr/bin/env node
// The executable entry point. During development `pnpm signa` runs it through tsx; an installable
// bin is P2. The command definition lives in cli.ts, which is safe to import.
import cli from "./cli.ts";

await cli.serve();
