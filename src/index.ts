import { ensureHome } from "./paths.js";
import { seedIfNeeded } from "./store.js";
import { startServer } from "./server.js";

await ensureHome();
await seedIfNeeded();
await startServer();
