"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const VAULT_FILE = "vault.enc";
function vaultPath() {
    return node_path_1.default.join(electron_1.app.getPath("userData"), VAULT_FILE);
}
function createWindow() {
    const window = new electron_1.BrowserWindow({
        width: 1120,
        height: 760,
        minWidth: 820,
        minHeight: 600,
        backgroundColor: "#0b1020",
        title: "Safora",
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });
    if (!electron_1.app.isPackaged) {
        void window.loadURL("http://127.0.0.1:5173");
    }
    else {
        void window.loadFile(node_path_1.default.join(__dirname, "../dist/index.html"));
    }
}
electron_1.ipcMain.handle("vault:read", async () => {
    try {
        return await node_fs_1.promises.readFile(vaultPath(), "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT")
            return null;
        throw error;
    }
});
electron_1.ipcMain.handle("vault:write", async (_event, encryptedPayload) => {
    if (typeof encryptedPayload !== "string" || encryptedPayload.length > 25_000_000) {
        throw new Error("Invalid vault payload.");
    }
    const target = vaultPath();
    const temporary = target + ".tmp";
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(target), { recursive: true, mode: 0o700 });
    await node_fs_1.promises.writeFile(temporary, encryptedPayload, { encoding: "utf8", mode: 0o600 });
    await node_fs_1.promises.rename(temporary, target);
    return true;
});
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
