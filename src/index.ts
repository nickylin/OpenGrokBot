import { ensureHome } from "./paths.js";
import { startScheduler } from "./scheduler.js";
import { seedIfNeeded } from "./store.js";
import { startServer } from "./server.js";

await ensureHome();
await seedIfNeeded();
startScheduler();
await startServer();
