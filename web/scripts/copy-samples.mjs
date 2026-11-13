// Copy the sample load-test files into public/ so the dashboard can offer them.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, "..", "public", "samples");
mkdirSync(dest, { recursive: true });
cpSync(join(here, "..", "..", "examples", "loadtests"), dest, { recursive: true });
