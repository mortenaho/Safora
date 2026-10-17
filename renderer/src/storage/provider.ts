/**
 * Provider-neutral storage contract.
 *
 * Implementations for OneDrive, Google Drive, Dropbox, and WebDAV will live in
 * separate modules. No provider is considered integrated until OAuth, token
 * storage, error handling, and real API tests are implemented.
 */

export type StorageProviderId =
  | "onedrive"
  | "google-drive"
  | "dropbox"
  | "webdav";

export interface RemoteObject {
  id: string;
  name: string;
  size: number;
  modifiedAt?: string;
  contentType?: string;
}

export interface UploadOptions {
  /** Optional remote parent/folder identifier. */
  parentId?: string;
  /** Optional MIME content type. */
  contentType?: string;
}

export interface CloudStorageProvider {
  readonly id: StorageProviderId;
  readonly displayName: string;

  isConnected(): Promise<boolean>;
  list(parentId?: string): Promise<RemoteObject[]>;
  download(objectId: string): Promise<Uint8Array>;
  upload(
    name: string,
    contents: Uint8Array,
    options?: UploadOptions
  ): Promise<RemoteObject>;
  delete(objectId: string): Promise<void>;
  disconnect(): Promise<void>;
}
