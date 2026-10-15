/**
 * Provider-neutral storage contract. Cloud adapters should implement this
 * interface without leaking provider-specific types into the vault core.
 */
export interface CloudFileMetadata {
  id: string;
  name: string;
  size: number;
  modifiedAt?: string;
  version?: string;
}

export interface ICloudStorageProvider {
  readonly providerId: string;
  upload(fileName: string, content: Uint8Array, signal?: AbortSignal): Promise<CloudFileMetadata>;
  download(fileId: string, signal?: AbortSignal): Promise<Uint8Array>;
  delete(fileId: string, signal?: AbortSignal): Promise<void>;
  listFiles(signal?: AbortSignal): Promise<readonly CloudFileMetadata[]>;
}

/** A provider may be unavailable until OAuth/configuration is implemented. */
export type StorageProviderStatus = "not-configured" | "connected" | "error";
