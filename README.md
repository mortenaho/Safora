# MoriVault Desktop

A cross-platform Electron password-vault starter for Linux and Windows. The first milestone focuses on a local encrypted vault and a provider-neutral cloud-storage boundary.

## Requirements

- Node.js 20+
- npm

## Run in development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run dist
```

## Current scope

- Electron + TypeScript + Vite
- Local vault file stored in the operating system's application-data directory
- Client-side encryption with PBKDF2-SHA-256 and AES-256-GCM
- Main/preload/renderer separation with context isolation enabled
- Storage provider contract for future OneDrive, Google Drive, Dropbox, WebDAV, and other adapters

Cloud adapters and OAuth are intentionally not represented as working integrations yet. Never store plaintext passwords or OAuth tokens in logs. Keep an independent recovery plan for the master password; it cannot be recovered by the application.

## Security notes

This is an early development scaffold, not a security-audited password manager. Do not use it for production secrets until the implementation has been reviewed and tested. The master password is never sent to a cloud provider by this scaffold.
