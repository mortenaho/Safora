# Safora Desktop

Safora is a cross-platform encrypted password vault built with **Tauri 2**, TypeScript, and Vite. The frontend stays provider-neutral so cloud-storage integrations can be added without coupling the vault core to a specific provider.

## Requirements

- Node.js 20+
- npm
- Rust stable toolchain (`rustup`, `cargo`)
- Tauri Linux prerequisites: WebKitGTK 4.1 and GTK / AppIndicator development packages for your distribution

Install the native prerequisites from the official Tauri documentation for your operating system before building.

## Run in development

```bash
npm install
npm run dev
```

For browser-only frontend work (the native vault bridge is unavailable outside Tauri):

```bash
npm run dev:web
```

## Build

```bash
npm run build:web
npm run dist
```

Tauri bundle targets are configured for Linux AppImage/deb and Windows NSIS. Build each target on a supported build environment; Windows installers generally should be built on Windows.

## Current implementation

- Tauri 2 native shell with a TypeScript/Vite frontend
- Local encrypted vault file in the OS application-data directory
- Client-side encryption using PBKDF2-SHA-256 and AES-256-GCM
- Rust commands for reading and writing the encrypted envelope
- Atomic replacement of the vault file and restrictive Unix file permissions
- Existing vault UI for creating, editing, searching, and deleting entries
- Provider-neutral cloud storage contract

Cloud OAuth and OneDrive, Google Drive, Dropbox, and WebDAV adapters are not yet working integrations. The vault file is encrypted locally before it is written. Never store plaintext passwords or OAuth tokens in logs. Keep an independent recovery plan for the master password; it cannot be recovered by the application.

## Security notes

This is an early development scaffold, not a security-audited password manager. Do not use it for production secrets until the implementation has been reviewed and tested. The master password is not sent to a cloud provider. Protecting the local OS account and keeping backups of the encrypted vault are still important.
