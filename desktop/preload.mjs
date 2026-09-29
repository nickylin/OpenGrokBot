import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("opengrokbot", {
  isDesktop: true,
  setOpenAtLogin: (enabled) => ipcRenderer.invoke("set-open-at-login", Boolean(enabled)),
});
