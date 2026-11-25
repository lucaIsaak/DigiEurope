import { watchFile } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { ONTOLOGY_FILE } from "./ontologyDoc.js";
import { seedDemoData } from "./seed.js";
import { Store } from "./store.js";

const port = Number(process.env.API_PORT ?? 4000);
const dataDir = resolve(process.env.DATA_DIR ?? "data");
const store = new Store(dataDir);

if (store.isNew && process.env.SEED_DEMO_DATA !== "false") {
  seedDemoData(store);
  console.log(`Seeded demo data into ${dataDir}`);
}

/** The context watcher sweeps on its own this often ("always on"); changes in the office wake it right away as well. */
const watchIntervalMs = Math.max(10_000, Number(process.env.WATCH_INTERVAL_MS ?? 5 * 60_000));
const api = buildApp({ store, logger: true, webUrl: process.env.WEB_URL, watchIntervalMs });
api.listen({ port, host: "0.0.0.0" }).catch((err) => {
  console.error(err);
  process.exit(1);
});
// Timers: every minute, processes whose waiting step has run out carry on.
setInterval(() => void api.inject({ method: "POST", url: "/admin/timers/run" }).catch(() => undefined), 60_000);
// Context watcher: one sweep at start, then on the schedule.
const sweep = () => void api.inject({ method: "POST", url: "/admin/watcher/run" }).catch(() => undefined);
void api.ready().then(sweep);
setInterval(sweep, watchIntervalMs);
// The ontology file is the source of truth: when someone edits it, the schema and the checks follow within a second.
watchFile(ONTOLOGY_FILE, { interval: 1000 }, () => void api.inject({ method: "POST", url: "/admin/ontology/check" }).catch(() => undefined));
