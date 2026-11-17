import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { seedDemoData } from "./seed.js";
import { Store } from "./store.js";

const port = Number(process.env.API_PORT ?? 4000);
const dataDir = resolve(process.env.DATA_DIR ?? "data");
const store = new Store(dataDir);

if (store.isNew && process.env.SEED_DEMO_DATA !== "false") {
  seedDemoData(store);
  console.log(`Seeded demo data into ${dataDir}`);
}

buildApp({ store, logger: true, webUrl: process.env.WEB_URL })
  .listen({ port, host: "0.0.0.0" })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
