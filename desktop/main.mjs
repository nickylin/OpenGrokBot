import { app, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import("node:child_process").ChildProcess | null} */
let serverProcess = null;

function serverPort() {
  return process.env.OPENGROKBOT_PORT ?? "3088";
}

function serverHost() {
  return process.env.OPENGROKBOT_HOST ?? "127.0.0.1";
}

function serverRoot() {
  if (app.isPackaged) return join(process.resourcesPath, "server");
  return join(__dirname, "..");
}

function serverUrl() {
  return `http://${serverHost()}:${serverPort()}`;
}

async function waitForHealth(timeoutMs = 60_000) {
  const url = `${serverUrl()}/api/health`;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`OpenGrokBot server did not become ready at ${url}`);
}

function startServer() {
  const root = serverRoot();
  const entry = join(root, "dist", "index.js");
  const node = process.env.OPENGROKBOT_NODE ?? "node";
  const env = {
    ...process.env,
    OPENGROKBOT_ROOT: root,
    OPENGROKBOT_PORT: serverPort(),
    OPENGROKBOT_HOST: serverHost(),
  };

  return spawn(node, [entry], {
    cwd: root,
    env,
    stdio: "inherit",
  });
}

function stopServer() {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill("SIGTERM");
  serverProcess = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "OpenGrokBot",
    backgroundColor: "#0a0a0a",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.on("page-title-updated", (ev) => {
    ev.preventDefault();
  });

  void mainWindow.loadURL(serverUrl());
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusMainWindow();
  });

  app.whenReady().then(async () => {
    if (process.platform === "darwin") {
      app.setAppUserModelId("com.opengrokbot.app");
    }

    if (app.isPackaged) {
      serverProcess = startServer();
      serverProcess.on("exit", (code, signal) => {
        if (code !== 0 && code !== null && signal !== "SIGTERM") {
          console.error(`OpenGrokBot server exited (${code ?? signal})`);
        }
      });
    }

    await waitForHealth();
    createWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("before-quit", stopServer);
}
