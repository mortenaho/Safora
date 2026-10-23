export {};

declare global {
  interface Window {
    safora: {
      readVault(): Promise<string | null>;
      writeVault(payload: string): Promise<boolean>;
    };
  }
}
