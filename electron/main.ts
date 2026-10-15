import { app, BrowserWindow, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

const VAULT_FILE = "vault.enc";

function vaultPath(): string {
  return path.join(app.getPath("userData"), VAULT_FILE);
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: "#0b1020",
    title: "MoriVault",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle("vault:read", async () => {
  try {
    return await fs.readFile(vaultPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
});

ipcMain.handle("vault:write", async (_event, encryptedPayload: string) => {
  if (typeof encryptedPayload !== "string" || encryptedPayload.length > 25_000_000) {
    throw new Error("Invalid vault payload.");
  }

  const target = vaultPath();
  const temporary = target + ".tmp";
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(temporary, encryptedPayload, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
  return true;
});

app.whenReady().then(() => {
  process.env.VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "";
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
