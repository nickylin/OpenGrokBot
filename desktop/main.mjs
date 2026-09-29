import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
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

function settingsFilePath() {
  const home = process.env.OPENGROKBOT_HOME ?? join(homedir(), ".opengrokbot");
  return join(home, "settings.json");
}

async function readOpenAtLoginFromDisk() {
  try {
    const path = settingsFilePath();
    if (!existsSync(path)) return false;
    const raw = JSON.parse(await readFile(path, "utf8"));
    return Boolean(raw.openAtLogin);
  } catch {
    return false;
  }
}

function applyLoginItem(openAtLogin) {
  app.setLoginItemSettings({
    openAtLogin: Boolean(openAtLogin),
    openAsHidden: true,
  });
}

function shouldStartHidden() {
  if (process.argv.includes("--hidden")) return true;
  if (process.platform === "darwin") {
    const { wasOpenedAsHidden } = app.getLoginItemSettings();
    if (wasOpenedAsHidden) return true;
  }
  return false;
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
    OPENGROKBOT_DESKTOP: "1",
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
    createWindow(false);
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

function createWindow(startHidden = false) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "OpenGrokBot",
    backgroundColor: "#0a0a0a",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.mjs"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (!startHidden) mainWindow?.show();
  });

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
  ipcMain.handle("set-open-at-login", (_event, enabled) => {
    applyLoginItem(enabled);
    return { ok: true, openAtLogin: Boolean(enabled) };
  });

  app.on("second-instance", () => {
    focusMainWindow();
  });

  app.whenReady().then(async () => {
    if (process.platform === "darwin") {
      app.setAppUserModelId("com.opengrokbot.app");
    }

    const openAtLogin = await readOpenAtLoginFromDisk();
    applyLoginItem(openAtLogin);

    if (app.isPackaged) {
      serverProcess = startServer();
      serverProcess.on("exit", (code, signal) => {
        if (code !== 0 && code !== null && signal !== "SIGTERM") {
          console.error(`OpenGrokBot server exited (${code ?? signal})`);
        }
      });
    }

    await waitForHealth();
    const startHidden = shouldStartHidden();
    createWindow(startHidden);
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
