import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;
/** @type {import("node:child_process").ChildProcess | null} */
let serverProcess = null;
let isQuitting = false;

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

function loadTrayIcon() {
  const candidates = [
    join(__dirname, "..", "build", "icon.png"),
    join(process.resourcesPath, "icon.png"),
    join(process.resourcesPath, "icon.icns"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    let image = nativeImage.createFromPath(path);
    if (image.isEmpty()) continue;
    if (process.platform === "darwin") {
      image = image.resize({ width: 18, height: 18 });
    } else if (process.platform === "win32") {
      image = image.resize({ width: 16, height: 16 });
    }
    return image;
  }
  return nativeImage.createEmpty();
}

function focusMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  const icon = loadTrayIcon();
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("OpenGrokBot");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show OpenGrokBot",
      click: () => focusMainWindow(),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    focusMainWindow();
  });
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

  mainWindow.on("close", (ev) => {
    if (!isQuitting) {
      ev.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("page-title-updated", (ev) => {
    ev.preventDefault();
  });

  void mainWindow.loadURL(serverUrl());
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
    createTray();
  });

  app.on("window-all-closed", () => {
    // Keep running in the menu-bar tray until the user chooses Quit.
  });

  app.on("activate", () => {
    focusMainWindow();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    stopServer();
  });
}
