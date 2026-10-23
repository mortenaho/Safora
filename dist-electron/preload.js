"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("safora", {
    readVault: () => electron_1.ipcRenderer.invoke("vault:read"),
    writeVault: (payload) => electron_1.ipcRenderer.invoke("vault:write", payload)
});
