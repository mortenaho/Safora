import { invoke } from "@tauri-apps/api/core";
import "./styles.css";
import {
  CATEGORIES,
  SYNC_PROVIDERS,
  blankFields,
  categoryById,
  connectionHint,
  AUTO_LOCK_MINUTES,
  autoLockLabel,
  autoLockMinutes,
  emptySync,
  fieldSummary,
  inputKind,
  isAutoPort,
  isCategoryId,
  isSyncProvider,
  normalizeVault,
  suggestedPort,
  visibleFacts,
  type CategoryId,
  type FieldDef,
  type SyncProviderId,
  type VaultData,
  type VaultEntry
} from "./catalog";

type EncryptedVault = { version: 1; salt: string; iv: string; iterations: number; ciphertext: string };
type WriteReport = { synced: boolean; message: string };
type VaultFilter = "all" | CategoryId;
type AppScreen = "items" | "sync" | "settings";
type Draft = { id?: string; category: CategoryId; title: string; notes: string; fields: Record<string, string> };

const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const app = document.querySelector<HTMLDivElement>("#app")!;
const vaultBridge = {
  readVault: () => invoke<string | null>("read_vault"),
  writeVault: (contents: string, syncFolder: string | null) => invoke<WriteReport>("write_vault", { contents, syncFolder }),
  checkSyncFolder: (folder: string) => invoke<string>("check_sync_folder", { folder }),
  suggestSyncFolder: (provider: SyncProviderId) => invoke<string | null>("suggest_sync_folder", { provider }),
  pickSyncFolder: () => invoke<string | null>("pick_sync_folder")
};

let vault: VaultData | null = null;
let masterKey: CryptoKey | null = null;
let selectedCategory: VaultFilter = "all";
let searchText = "";
let screen: AppScreen = "items";
let syncNotice = "";
let settingsNotice = "";
let lastActivity = Date.now();
let autoLockTimer: number | null = null;
let activityGate = false;

const ICONS: Record<VaultFilter, string> = {
  all: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.4"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4"/></svg>`,
  server: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="3.5" width="18" height="6.5" rx="1.6"/><rect x="3" y="14" width="18" height="6.5" rx="1.6"/><circle cx="7" cy="6.7" r="0.8" fill="currentColor" stroke="none"/><circle cx="7" cy="17.2" r="0.8" fill="currentColor" stroke="none"/></svg>`,
  email: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7l8 6 8-6"/></svg>`,
  website: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.4 2.6 2.4 13.4 0 16M12 4c-2.4 2.6-2.4 13.4 0 16"/></svg>`,
  ftp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h10M11 5l3 3-3 3"/><path d="M20 16H10M13 13l-3 3 3 3"/></svg>`,
  database: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v10c0 1.7 3.1 3 7 3s7-1.3 7-3V7"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>`
};

function icon(id: VaultFilter): string {
  return `<span class="cat-icon">${ICONS[id]}</span>`;
}
function logoMark(): string {
  return `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#101714"/><circle cx="32" cy="31.6" r="22.6" fill="none" stroke="#e6b15a" stroke-width="1.7"/><path d="M40.6 23.4C40 18.6 36.2 16.4 31.5 16.4 25.2 16.4 21.8 19.6 21.8 23.6 21.8 27.4 25.2 29.2 32 30.8 39 32.5 42.2 34.6 42.2 38.8 42.2 43.6 37.6 46.8 31.5 46.8 25.2 46.8 21.4 43.4 20.8 39.2" fill="none" stroke="#f6edd9" stroke-width="4.35" stroke-linecap="round"/></svg>`;
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function readFilter(value: string | undefined): VaultFilter {
  if (value === "all" || (value && isCategoryId(value))) return value;
  return "all";
}
function countFor(filter: VaultFilter): number {
  if (!vault) return 0;
  return filter === "all" ? vault.entries.length : vault.entries.filter(entry => entry.category === filter).length;
}
function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, byte => chars[byte % chars.length]).join("");
}
async function writeClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.focus();
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("Could not copy");
  }
}
async function copyText(value: string, button: HTMLButtonElement): Promise<void> {
  const previous = button.textContent;
  try {
    await writeClipboard(value);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Failed";
  }
  window.setTimeout(() => { button.textContent = previous; }, 1200);
}
const dismissers = new Set<() => void>();
function closeModals(): void {
  [...dismissers].forEach(finish => finish());
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptVault(data: VaultData, key: CryptoKey, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(data)));
  const payload: EncryptedVault = {
    version: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    iterations: ITERATIONS,
    ciphertext: toBase64(new Uint8Array(ciphertext))
  };
  return JSON.stringify(payload);
}
async function decryptVault(raw: string, password: string): Promise<{ data: VaultData; key: CryptoKey }> {
  const payload = JSON.parse(raw) as EncryptedVault;
  if (payload.version !== 1 || payload.iterations < 100_000) throw new Error("Unsupported or invalid vault format.");
  const key = await deriveKey(password, fromBase64(payload.salt));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(payload.iv) },
    key,
    fromBase64(payload.ciphertext)
  );
  return { data: normalizeVault(JSON.parse(decoder.decode(plaintext))), key };
}
async function saveVault(): Promise<void> {
  if (!vault || !masterKey) throw new Error("Vault is locked.");
  const raw = await vaultBridge.readVault();
  const salt = raw ? fromBase64((JSON.parse(raw) as EncryptedVault).salt) : crypto.getRandomValues(new Uint8Array(16));
  const folder = vault.sync.provider && vault.sync.folder ? vault.sync.folder : null;
  const report = await vaultBridge.writeVault(await encryptVault(vault, masterKey, salt), folder);
  syncNotice = report.message;
}

function clearAutoLockTimer(): void {
  if (autoLockTimer !== null) {
    window.clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

function idleLimitMs(): number {
  return (vault?.autoLockMinutes ?? 0) * 60_000;
}

function lockVault(): void {
  clearAutoLockTimer();
  vault = null;
  masterKey = null;
  searchText = "";
  selectedCategory = "all";
  screen = "items";
  syncNotice = "";
  settingsNotice = "";
  showUnlock();
}

function scheduleAutoLock(): void {
  clearAutoLockTimer();
  const limit = idleLimitMs();
  if (!vault || !masterKey || limit <= 0) return;
  const remaining = limit - (Date.now() - lastActivity);
  if (remaining <= 0) {
    lockVault();
    return;
  }
  autoLockTimer = window.setTimeout(checkAutoLock, remaining);
}

function checkAutoLock(): void {
  if (!vault || !masterKey) return;
  const limit = idleLimitMs();
  if (limit <= 0) {
    clearAutoLockTimer();
    return;
  }
  if (Date.now() - lastActivity >= limit) lockVault();
  else scheduleAutoLock();
}

function noteActivity(): void {
  if (!vault || !masterKey) return;
  lastActivity = Date.now();
  if (activityGate) return;
  activityGate = true;
  window.setTimeout(() => {
    activityGate = false;
    if (vault && masterKey) scheduleAutoLock();
  }, 1000);
}

function armAutoLock(): void {
  lastActivity = Date.now();
  scheduleAutoLock();
}

function showUnlock(): void {
  closeCopyMenu();
  closeModals();
  app.innerHTML = `
    <main class="lock">
      <form id="unlock-form" class="lock-form">
        <div class="lock-brand">${logoMark()}<h1>Safora</h1></div>
        <label for="master-password">Master password</label>
        <div class="lock-field">
          <input id="master-password" type="password" autocomplete="current-password" minlength="8" required autofocus placeholder="At least 8 characters" />
          <button id="toggle-password" type="button" aria-pressed="false" aria-label="Show password">Show</button>
        </div>
        <p id="auth-error" class="error" role="alert"></p>
        <button id="unlock-button" class="primary full" type="submit">Unlock</button>
      </form>
    </main>`;
  const input = document.querySelector<HTMLInputElement>("#master-password")!;
  const toggle = document.querySelector<HTMLButtonElement>("#toggle-password")!;
  toggle.addEventListener("click", () => {
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    toggle.textContent = visible ? "Hide" : "Show";
    toggle.setAttribute("aria-pressed", String(visible));
    toggle.setAttribute("aria-label", visible ? "Hide password" : "Show password");
    input.focus();
  });
  document.querySelector<HTMLFormElement>("#unlock-form")!.addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.querySelector<HTMLButtonElement>("#unlock-button")!;
    const error = document.querySelector<HTMLParagraphElement>("#auth-error")!;
    button.disabled = true;
    button.textContent = "Unlocking…";
    error.textContent = "";
    event.currentTarget instanceof HTMLFormElement && event.currentTarget.classList.remove("denied");
    try {
      const raw = await vaultBridge.readVault();
      if (raw) {
        const result = await decryptVault(raw, input.value);
        vault = result.data;
        masterKey = result.key;
      } else {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        masterKey = await deriveKey(input.value, salt);
        vault = { schemaVersion: 2, entries: [], sync: emptySync(), autoLockMinutes: 5 };
        await vaultBridge.writeVault(await encryptVault(vault, masterKey, salt), null);
      }
      armAutoLock();
      renderVault();
    } catch {
      error.textContent = "Wrong password.";
      button.disabled = false;
      button.form?.classList.add("denied");
      button.textContent = "Unlock";
      input.focus();
    }
  });
}

function copyActions(entry: VaultEntry): { label: string; value: string }[] {
  return categoryById(entry.category).fields.flatMap(field => {
    const value = entry.fields[field.key]?.trim() ?? "";
    return value ? [{ label: field.label, value }] : [];
  });
}

let copyMenu: HTMLElement | null = null;

function closeCopyMenu(): void {
  copyMenu?.remove();
  copyMenu = null;
  document.removeEventListener("pointerdown", dismissCopyMenu, true);
  document.removeEventListener("keydown", dismissCopyMenuKey);
  window.removeEventListener("scroll", closeCopyMenu, true);
  window.removeEventListener("resize", closeCopyMenu);
}

function dismissCopyMenu(event: Event): void {
  if (copyMenu && event.target instanceof Node && copyMenu.contains(event.target)) return;
  closeCopyMenu();
}

function dismissCopyMenuKey(event: KeyboardEvent): void {
  if (event.key === "Escape") closeCopyMenu();
}

function showCopyMenu(entry: VaultEntry, x: number, y: number): void {
  closeCopyMenu();
  const actions = copyActions(entry);
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `<p>Copy</p>${actions.length
    ? actions.map((action, index) => `<button type="button" role="menuitem" data-copy-index="${index}">${escapeHtml(action.label)}</button>`).join("")
    : `<button type="button" disabled>Nothing to copy</button>`}`;
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
  copyMenu = menu;
  menu.addEventListener("contextmenu", event => event.preventDefault());
  menu.querySelectorAll<HTMLButtonElement>("[data-copy-index]").forEach(button => {
    button.addEventListener("click", async () => {
      const action = actions[Number(button.dataset.copyIndex)];
      if (!action) return;
      try {
        await writeClipboard(action.value);
        button.textContent = "Copied";
        button.classList.add("copied");
      } catch {
        button.textContent = "Could not copy";
      }
      window.setTimeout(closeCopyMenu, 700);
    });
  });
  document.addEventListener("pointerdown", dismissCopyMenu, true);
  document.addEventListener("keydown", dismissCopyMenuKey);
  window.addEventListener("scroll", closeCopyMenu, true);
  window.addEventListener("resize", closeCopyMenu);
}

function renderVault(): void {
  closeCopyMenu();
  if (!vault) return;
  const query = searchText.trim().toLowerCase();
  const active = selectedCategory === "all" ? null : categoryById(selectedCategory);
  const filtered = vault.entries.filter(entry => {
    if (selectedCategory !== "all" && entry.category !== selectedCategory) return false;
    if (!query) return true;
    const haystack = [entry.title, entry.notes, categoryById(entry.category).label, ...Object.values(entry.fields)].join("\n").toLowerCase();
    return haystack.includes(query);
  });
  const heading = active ? active.label : "Everything";
  const description = active ? active.description : "Five collections, each with the fields that belong to it.";
  const addLabel = active ? `New ${active.noun}` : "Add item";
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">${logoMark()}<span class="wordmark">Safora</span></div>
        <p class="nav-label">COLLECTIONS</p>
        <nav>
          <button class="nav-item ${screen === "items" && selectedCategory === "all" ? "active" : ""}" data-category="all" data-kind="all">${icon("all")}<span>All</span><span class="count">${countFor("all")}</span></button>
          ${CATEGORIES.map(category => `<button class="nav-item ${screen === "items" && selectedCategory === category.id ? "active" : ""}" data-category="${category.id}" data-kind="${category.id}">${icon(category.id)}<span>${escapeHtml(category.label)}</span><span class="count">${countFor(category.id)}</span></button>`).join("")}
        </nav>
        <div class="sidebar-bottom">
          <button id="settings-button" class="nav-item ${screen === "settings" ? "active" : ""}" type="button" data-kind="all"><span class="cat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3.2v2.3M12 18.5v2.3M4.9 6.2l1.6 1.6M17.5 16.2l1.6 1.6M3.2 12h2.3M18.5 12h2.3M4.9 17.8l1.6-1.6M17.5 7.8l1.6-1.6"/></svg></span><span>Settings</span></button>
          <button id="sync-button" class="nav-item ${screen === "sync" ? "active" : ""}" type="button" data-kind="all"><span class="cat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.6A3.5 3.5 0 0 0 7 18z"/></svg></span><span>Sync</span><span class="count">${vault.sync.provider ? "On" : "Off"}</span></button>
          <div class="secure-status"><span class="status-indicator"></span><div><strong>Vault encrypted</strong><small>${vault.autoLockMinutes ? `Locks after ${autoLockLabel(vault.autoLockMinutes).toLowerCase()} idle` : vault.sync.provider ? "Cloud copy enabled" : "Stored on this device"}</small></div></div>
          <button id="lock-button" class="text-button" type="button">Lock vault</button>
        </div>
      </aside>
      <main class="content">
        ${screen === "sync" ? renderSyncPage() : screen === "settings" ? renderSettingsPage() : renderItemsPage(active, filtered, heading, description, addLabel)}
      </main>
    </div>`;
  document.querySelectorAll<HTMLButtonElement>("[data-category]").forEach(button => {
    button.addEventListener("click", () => {
      screen = "items";
      selectedCategory = readFilter(button.dataset.category);
      renderVault();
    });
  });
  document.querySelector("#sync-button")?.addEventListener("click", () => {
    screen = "sync";
    renderVault();
  });
  document.querySelector("#settings-button")?.addEventListener("click", () => {
    screen = "settings";
    renderVault();
  });
  if (screen === "sync") bindSyncPage();
  if (screen === "settings") bindSettingsPage();
  document.querySelector<HTMLInputElement>("#search")?.addEventListener("input", event => {
    const input = event.target as HTMLInputElement;
    searchText = input.value;
    const position = input.selectionStart ?? searchText.length;
    renderVault();
    const next = document.querySelector<HTMLInputElement>("#search");
    next?.focus();
    next?.setSelectionRange(position, position);
  });
  document.querySelector("#add-button")?.addEventListener("click", openAdd);
  document.querySelector("#empty-add")?.addEventListener("click", openAdd);
  document.querySelector("#lock-button")?.addEventListener("click", () => {
    lockVault();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-entry]").forEach(button => {
    const entry = () => vault?.entries.find(item => item.id === button.dataset.entry);
    button.addEventListener("click", () => {
      const item = entry();
      if (item) showEntryForm(item);
    });
    button.addEventListener("contextmenu", event => {
      event.preventDefault();
      const item = entry();
      if (item) showCopyMenu(item, event.clientX, event.clientY);
    });
  });
}

function renderItemsPage(active: ReturnType<typeof categoryById> | null, filtered: VaultEntry[], heading: string, description: string, addLabel: string): string {
  return `
    <header class="topbar">
      <div>
        <h1>${escapeHtml(heading)}</h1>
        <p class="muted">${escapeHtml(description)}</p>
      </div>
      <button id="add-button" class="primary" type="button">${escapeHtml(addLabel)}</button>
    </header>
    ${selectedCategory === "all" ? `<div class="kind-strip">${CATEGORIES.map(category => `<button class="kind-card" type="button" data-category="${category.id}" data-kind="${category.id}">${icon(category.id)}<span>${escapeHtml(category.label)}</span><span class="count">${countFor(category.id)}</span></button>`).join("")}</div>` : ""}
    <section class="board">
      <div class="board-bar">
        <div class="search-wrap"><span>⌕</span><input id="search" placeholder="${active ? `Search ${escapeHtml(active.label.toLowerCase())}` : "Search the vault"}" value="${escapeHtml(searchText)}" /></div>
        <span class="list-meta">${filtered.length} shown</span>
      </div>
      <div class="items-list">
        ${filtered.length ? filtered.map(renderRow).join("") : `<div class="empty"><h2>No ${escapeHtml(active ? active.noun : "items")} yet</h2><p class="muted">${escapeHtml(active ? active.description : "Choose a collection and add the first record.")}</p><button id="empty-add" class="primary" type="button">${escapeHtml(addLabel)}</button></div>`}
      </div>
    </section>`;
}

function renderSettingsPage(): string {
  if (!vault) return "";
  const selected = vault.autoLockMinutes;
  return `
    <header class="topbar">
      <div>
        <h1>Settings</h1>
        <p class="muted">Lock the vault on its own when you step away.</p>
      </div>
    </header>
    <section class="board settings-panel">
      <label for="auto-lock">Auto-lock</label>
      <select id="auto-lock">
        ${AUTO_LOCK_MINUTES.map(minutes => `<option value="${minutes}"${minutes === selected ? " selected" : ""}>${escapeHtml(autoLockLabel(minutes))}</option>`).join("")}
      </select>
      <p class="muted settings-help">${selected === 0 ? "The vault stays open until you lock it." : `After ${autoLockLabel(selected).toLowerCase()} without using Safora, it locks and asks for the master password.`}</p>
      <p id="settings-status" class="sync-status" role="status">${escapeHtml(settingsNotice)}</p>
    </section>`;
}

function bindSettingsPage(): void {
  document.querySelector("#auto-lock")?.addEventListener("change", async event => {
    if (!vault || !(event.target instanceof HTMLSelectElement)) return;
    const minutes = autoLockMinutes(Number(event.target.value));
    const previous = vault.autoLockMinutes;
    if (minutes === previous) return;
    vault.autoLockMinutes = minutes;
    const status = document.querySelector<HTMLParagraphElement>("#settings-status");
    event.target.disabled = true;
    try {
      await saveVault();
      settingsNotice = minutes === 0 ? "Auto-lock is off." : `Auto-lock set to ${autoLockLabel(minutes).toLowerCase()}.`;
      armAutoLock();
      renderVault();
    } catch {
      vault.autoLockMinutes = previous;
      event.target.disabled = false;
      event.target.value = String(previous);
      if (status) status.textContent = "Could not save auto-lock.";
    }
  });
}

function renderSyncPage(): string {
  if (!vault) return "";
  const selected = vault.sync.provider;
  const provider = SYNC_PROVIDERS.find(item => item.id === selected);
  return `
    <header class="topbar">
      <div>
        <h1>Sync</h1>
        <p class="muted">Safora copies the encrypted vault into the Google Drive or OneDrive folder already connected on this computer.</p>
      </div>
    </header>
    <div class="sync-grid">
      ${SYNC_PROVIDERS.map(item => `<button class="sync-card ${selected === item.id ? "selected" : ""}" type="button" data-provider="${item.id}"><span class="sync-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.6A3.5 3.5 0 0 0 7 18z"/></svg></span><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.detail)}</span></button>`).join("")}
    </div>
    <section class="board sync-panel">
      <label for="sync-folder">Cloud folder</label>
      <div class="folder-row">
        <input id="sync-folder" spellcheck="false" value="${escapeHtml(vault.sync.folder)}" placeholder="${selected === "google-drive" ? "Google Drive folder" : "OneDrive folder"}" />
        <button id="sync-browse" class="secondary" type="button">Choose folder</button>
      </div>
      <p class="muted sync-help">${provider ? `Safora/vault.enc is written inside the ${escapeHtml(provider.label)} folder you choose. Connect that account on this computer first.` : "Pick Google Drive or OneDrive, then choose the folder its app syncs."}</p>
      <p id="sync-status" class="sync-status ${syncNotice.includes("failed") ? "warn" : ""}" role="status">${escapeHtml(syncNotice)}</p>
      <div class="sync-actions">
        <button id="sync-clear" class="secondary" type="button">This device only</button>
        <button id="sync-save" class="primary" type="button">Save sync settings</button>
      </div>
    </section>`;
}

async function bindSyncPage(): Promise<void> {
  const status = document.querySelector<HTMLParagraphElement>("#sync-status");
  const folderInput = () => document.querySelector<HTMLInputElement>("#sync-folder");
  const selectedProvider = () => {
    const card = document.querySelector<HTMLButtonElement>(".sync-card.selected");
    return isSyncProvider(card?.dataset.provider) ? card.dataset.provider : null;
  };
  document.querySelectorAll<HTMLButtonElement>(".sync-card").forEach(card => {
    card.addEventListener("click", async () => {
      document.querySelectorAll(".sync-card").forEach(item => item.classList.remove("selected"));
      card.classList.add("selected");
      const input = folderInput();
      const provider = card.dataset.provider;
      if (input && !input.value.trim() && isSyncProvider(provider)) {
        const missing = provider === "google-drive"
          ? "Google Drive is not connected on this computer. Connect the account, then choose its folder."
          : "OneDrive is not connected on this computer. Connect the account, then choose its folder.";
        try {
          const suggested = await vaultBridge.suggestSyncFolder(provider);
          if (suggested && !input.value.trim()) input.value = suggested;
          else if (status) status.textContent = missing;
        } catch {
          if (status) status.textContent = missing;
        }
      }
    });
  });
  document.querySelector("#sync-browse")?.addEventListener("click", async () => {
    try {
      const picked = await vaultBridge.pickSyncFolder();
      const input = folderInput();
      if (picked && input) {
        input.value = picked;
        if (status) status.textContent = "";
      }
    } catch {
      if (status) status.textContent = "Choose the folder from the Safora desktop app.";
    }
  });
  document.querySelector("#sync-clear")?.addEventListener("click", async () => {
    if (!vault) return;
    vault.sync = emptySync();
    try {
      await saveVault();
      syncNotice = "Sync is off. The vault stays on this device.";
      renderVault();
    } catch {
      if (status) status.textContent = "Could not save sync settings.";
    }
  });
  document.querySelector("#sync-save")?.addEventListener("click", async () => {
    if (!vault) return;
    const provider = selectedProvider();
    const folder = folderInput()?.value.trim() ?? "";
    if (!provider) {
      if (status) status.textContent = "Choose OneDrive or Google Drive.";
      return;
    }
    if (!folder) {
      if (status) status.textContent = "Choose the folder that OneDrive or Google Drive syncs.";
      return;
    }
    const button = document.querySelector<HTMLButtonElement>("#sync-save");
    if (button) button.disabled = true;
    try {
      const checked = await vaultBridge.checkSyncFolder(folder);
      vault.sync = { provider, folder: checked };
      await saveVault();
      syncNotice = syncNotice || `Encrypted copy saved in ${checked}/Safora/vault.enc.`;
      renderVault();
    } catch (error) {
      if (button) button.disabled = false;
      if (status) {
        status.classList.add("warn");
        status.textContent = typeof error === "string" && error.trim() ? error : "Could not use that folder.";
      }
    }
  });
}

function renderRow(entry: VaultEntry): string {
  const facts = visibleFacts(entry);
  const factHtml = facts.length
    ? facts.map(fact => `<span class="fact"><em>${escapeHtml(fact.label)}</em>${escapeHtml(fact.value)}</span>`).join("")
    : `<span class="fact">No details yet</span>`;
  return `<button class="item-row" type="button" data-entry="${escapeHtml(entry.id)}" data-kind="${entry.category}"><span class="item-mark">${icon(entry.category)}</span><span class="item-copy"><span class="item-title">${escapeHtml(entry.title)}</span><span class="facts">${factHtml}</span></span><span class="badge">${escapeHtml(categoryById(entry.category).label)}</span><time>${escapeHtml(formatWhen(entry.updatedAt))}</time></button>`;
}

function openAdd(): void {
  if (selectedCategory === "all") showTypePicker();
  else showEntryForm(undefined, selectedCategory);
}

function showTypePicker(): void {
  closeModals();
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="picker-title">
      <div class="modal-head"><div><p class="eyebrow">NEW ITEM</p><h2 id="picker-title">Choose a collection</h2></div><button class="icon-button" id="close-modal" type="button" aria-label="Close">×</button></div>
      <div class="picker">
        ${CATEGORIES.map(category => `<button class="picker-card" type="button" data-pick="${category.id}" data-kind="${category.id}"><span class="picker-mark">${icon(category.id)}</span><span class="picker-main"><strong>${escapeHtml(category.label)}</strong><small>${escapeHtml(fieldSummary(category.id))}</small></span></button>`).join("")}
      </div>
    </section>`;
  document.body.append(overlay);
  bindDismiss(overlay, () => overlay.remove());
  overlay.querySelectorAll<HTMLButtonElement>("[data-pick]").forEach(button => {
    button.addEventListener("click", () => {
      const category = button.dataset.pick;
      if (isCategoryId(category)) showEntryForm(undefined, category);
    });
  });
}

function renderField(field: FieldDef, value: string): string {
  const id = `field-${field.key}`;
  const kind = inputKind(field);
  const required = field.required ? " required" : "";
  const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : "";
  const escaped = escapeHtml(value);
  let control: string;
  if (kind === "textarea") {
    control = `<textarea class="mono" id="${id}" rows="5" spellcheck="false"${required}${placeholder}>${escaped}</textarea>`;
  } else if (kind === "select") {
    const options = field.options ?? [];
    const list = value && !options.includes(value) ? [value, ...options] : options;
    control = `<select id="${id}">${list.map(option => `<option${option === value ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
  } else if (kind === "password") {
    control = `<div class="secret-line"><input id="${id}" type="password" autocomplete="new-password" spellcheck="false" value="${escaped}"${required}${placeholder} /><button class="mini" type="button" data-toggle="${field.key}">Show</button><button class="mini" type="button" data-copy="${field.key}">Copy</button>${field.key === "password" ? `<button class="mini" type="button" data-generate="${field.key}">Generate</button>` : ""}</div>`;
  } else {
    const mode = kind === "number" ? ` inputmode="numeric"` : "";
    control = `<input id="${id}" type="${kind === "number" ? "text" : kind}" autocomplete="off" spellcheck="false" value="${escaped}"${required}${placeholder}${mode} />`;
  }
  return `<div class="field${field.wide ? " field-wide" : ""}"><label for="${id}">${escapeHtml(field.label)}${field.required ? " *" : ""}</label>${control}</div>`;
}

function formBody(draft: Draft): string {
  const definition = categoryById(draft.category);
  return `
    <div class="field"><label for="title">Name *</label><input id="title" required maxlength="120" value="${escapeHtml(draft.title)}" placeholder="What you call this ${escapeHtml(definition.noun)}" /></div>
    <div class="form-grid">${definition.fields.map(field => renderField(field, draft.fields[field.key] ?? "")).join("")}</div>
    <div class="field"><label for="notes">Notes</label><textarea id="notes" rows="3">${escapeHtml(draft.notes)}</textarea></div>
    <div class="hint"><code id="connection-hint"></code><button class="mini" id="copy-hint" type="button">Copy</button></div>`;
}

function fieldElement(form: HTMLFormElement, key: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  return form.querySelector(`#field-${key}`);
}

function currentFields(form: HTMLFormElement, category: CategoryId, base: Record<string, string>): Record<string, string> {
  const fields = { ...base };
  for (const field of categoryById(category).fields) {
    const element = fieldElement(form, field.key);
    if (element) fields[field.key] = element.value;
  }
  return fields;
}

function showEntryForm(entry?: VaultEntry, preset?: CategoryId): void {
  if (!vault) return;
  const draft: Draft = entry
    ? { id: entry.id, category: entry.category, title: entry.title, notes: entry.notes, fields: { ...entry.fields } }
    : { category: preset ?? "website", title: "", notes: "", fields: blankFields(preset ?? "website") };
  closeModals();
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  const noun = () => categoryById(draft.category).noun;
  overlay.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="entry-title">
      <div class="modal-head"><div><p class="eyebrow">SECURE ITEM</p><h2 id="entry-title">${entry ? "Edit" : "New"} ${escapeHtml(noun())}</h2></div><button class="icon-button" id="close-modal" type="button" aria-label="Close">×</button></div>
      <form id="entry-form">
        <label for="category">Collection</label>
        <select id="category">${CATEGORIES.map(category => `<option value="${category.id}"${category.id === draft.category ? " selected" : ""}>${escapeHtml(category.label)}</option>`).join("")}</select>
        <div id="form-body">${formBody(draft)}</div>
        <p id="form-error" class="error" role="alert"></p>
        <div class="modal-actions">${draft.id ? `<button class="danger" id="delete-entry" type="button">Delete</button>` : `<span class="spacer"></span>`}<button class="secondary" id="cancel-modal" type="button">Cancel</button><button class="primary" id="save-entry" type="submit">Save</button></div>
      </form>
    </section>`;
  document.body.append(overlay);
  const form = overlay.querySelector<HTMLFormElement>("#entry-form")!;
  const close = () => overlay.remove();
  bindDismiss(overlay, close);

  const paint = () => {
    const body = form.querySelector<HTMLDivElement>("#form-body");
    if (body) body.innerHTML = formBody(draft);
    const title = overlay.querySelector("#entry-title");
    if (title) title.textContent = `${draft.id ? "Edit" : "New"} ${noun()}`;
    refreshHint();
  };
  const refreshHint = () => {
    const hint = form.querySelector("#connection-hint");
    if (hint) hint.textContent = connectionHint(draft.category, currentFields(form, draft.category, draft.fields));
  };
  const syncDraft = () => {
    draft.title = form.querySelector<HTMLInputElement>("#title")?.value ?? draft.title;
    draft.notes = form.querySelector<HTMLTextAreaElement>("#notes")?.value ?? draft.notes;
    draft.fields = currentFields(form, draft.category, draft.fields);
  };

  form.addEventListener("input", refreshHint);
  form.addEventListener("change", event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === "category" && target instanceof HTMLSelectElement && isCategoryId(target.value)) {
      syncDraft();
      draft.category = target.value;
      for (const field of categoryById(draft.category).fields) {
        if (field.defaultValue && !(draft.fields[field.key] ?? "").trim()) draft.fields[field.key] = field.defaultValue;
      }
      const nextPort = suggestedPort(draft.category, draft.fields);
      if (nextPort !== undefined && isAutoPort(draft.fields.port ?? "")) draft.fields.port = nextPort;
      paint();
      return;
    }
    if (target.id === "field-protocol" || target.id === "field-engine") {
      const portInput = fieldElement(form, "port");
      const fields = currentFields(form, draft.category, draft.fields);
      const nextPort = suggestedPort(draft.category, fields);
      if (portInput && nextPort !== undefined && isAutoPort(portInput.value)) portInput.value = nextPort;
    }
    refreshHint();
  });
  form.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest("button");
    if (!button) return;
    const toggle = button.dataset.toggle;
    const copy = button.dataset.copy;
    const generate = button.dataset.generate;
    if (toggle) {
      const input = fieldElement(form, toggle);
      if (input instanceof HTMLInputElement) {
        input.type = input.type === "password" ? "text" : "password";
        button.textContent = input.type === "password" ? "Show" : "Hide";
      }
    }
    if (copy) {
      const input = fieldElement(form, copy);
      if (input) void copyText(input.value, button);
    }
    if (generate) {
      const input = fieldElement(form, generate);
      if (input instanceof HTMLInputElement) {
        input.value = generatePassword();
        input.type = "text";
        const toggleButton = form.querySelector<HTMLButtonElement>(`[data-toggle="${generate}"]`);
        if (toggleButton) toggleButton.textContent = "Hide";
        refreshHint();
      }
    }
    if (button.id === "copy-hint") {
      const hint = form.querySelector("#connection-hint");
      if (hint) void copyText(hint.textContent ?? "", button);
    }
  });
  overlay.querySelector("#delete-entry")?.addEventListener("click", async () => {
    if (!draft.id || !vault || !confirm("Delete this item permanently from the local vault?")) return;
    const previous = vault.entries.slice();
    vault.entries = vault.entries.filter(item => item.id !== draft.id);
    try {
      await saveVault();
      close();
      renderVault();
    } catch {
      vault.entries = previous;
      const error = form.querySelector("#form-error");
      if (error) error.textContent = "Could not delete this item.";
    }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!vault) return;
    syncDraft();
    const title = draft.title.trim();
    const error = form.querySelector("#form-error");
    const fields: Record<string, string> = {};
    for (const field of categoryById(draft.category).fields) {
      const value = (draft.fields[field.key] ?? "").trim();
      if (value) fields[field.key] = value;
    }
    if (!title) {
      if (error) error.textContent = "Name is required.";
      return;
    }
    if (draft.category === "database" && fields.engine !== "SQLite" && !fields.host) {
      if (error) error.textContent = "Host is required unless the engine is SQLite.";
      return;
    }
    const item: VaultEntry = {
      id: draft.id || crypto.randomUUID(),
      category: draft.category,
      title,
      fields,
      notes: draft.notes.trim(),
      updatedAt: new Date().toISOString()
    };
    const saveButton = form.querySelector<HTMLButtonElement>("#save-entry");
    if (saveButton) saveButton.disabled = true;
    const previous = vault.entries.slice();
    vault.entries = draft.id
      ? vault.entries.map(existing => existing.id === draft.id ? item : existing)
      : [item, ...vault.entries];
    try {
      await saveVault();
      close();
      selectedCategory = draft.category;
      renderVault();
    } catch {
      vault.entries = previous;
      if (saveButton) saveButton.disabled = false;
      if (error) error.textContent = "Could not save this item.";
    }
  });
  paint();
  form.querySelector<HTMLInputElement>("#title")?.focus();
}

function bindDismiss(overlay: HTMLElement, close: () => void): void {
  const finish = () => {
    document.removeEventListener("keydown", onKey);
    dismissers.delete(finish);
    if (overlay.isConnected) close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") finish();
  };
  dismissers.add(finish);
  document.addEventListener("keydown", onKey);
  overlay.querySelector("#close-modal")?.addEventListener("click", finish);
  overlay.querySelector("#cancel-modal")?.addEventListener("click", finish);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) finish();
  });
}

for (const eventName of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const) {
  window.addEventListener(eventName, noteActivity, { capture: true, passive: true });
}
window.addEventListener("focus", checkAutoLock);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkAutoLock();
});
window.setInterval(() => {
  if (vault && masterKey) checkAutoLock();
}, 15_000);

showUnlock();
