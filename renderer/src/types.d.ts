export {};

declare global {
  interface Window {
    moriVault: {
      readVault(): Promise<string | null>;
      writeVault(payload: string): Promise<boolean>;
    };
  }
}
