import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("moriVault", {
  readVault: (): Promise<string | null> => ipcRenderer.invoke("vault:read"),
  writeVault: (payload: string): Promise<boolean> => ipcRenderer.invoke("vault:write", payload)
});
