import "./styles.css";

type VaultEntry = {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  category: string;
  updatedAt: string;
};

type VaultData = { schemaVersion: 1; entries: VaultEntry[] };
type EncryptedVault = { version: 1; salt: string; iv: string; iterations: number; ciphertext: string };

const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let vault: VaultData | null = null;
let masterKey: CryptoKey | null = null;
let selectedCategory = "All items";
let searchText = "";

const app = document.querySelector<HTMLDivElement>("#app")!;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptVault(data: VaultData, key: CryptoKey, salt: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(data)));
  const payload: EncryptedVault = { version: 1, salt: toBase64(salt), iv: toBase64(iv), iterations: ITERATIONS, ciphertext: toBase64(new Uint8Array(ciphertext)) };
  return JSON.stringify(payload);
}
async function decryptVault(raw: string, password: string): Promise<{ data: VaultData; key: CryptoKey }> {
  const payload = JSON.parse(raw) as EncryptedVault;
  if (payload.version !== 1 || payload.iterations < 100_000) throw new Error("Unsupported or invalid vault format.");
  const key = await deriveKey(password, fromBase64(payload.salt));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(payload.iv) }, key, fromBase64(payload.ciphertext));
  const data = JSON.parse(decoder.decode(plaintext)) as VaultData;
  if (data.schemaVersion !== 1 || !Array.isArray(data.entries)) throw new Error("Invalid vault contents.");
  return { data, key };
}
function showUnlock(): void {
  app.innerHTML = `
    <main class="auth-layout">
      <section class="auth-card">
        <div class="brand-mark">M</div>
        <p class="eyebrow">PRIVATE BY DESIGN</p>
        <h1>MoriVault</h1>
        <p class="muted">Your passwords, encrypted before they leave your device.</p>
        <form id="unlock-form">
          <label for="master-password">Master password</label>
          <input id="master-password" type="password" autocomplete="current-password" minlength="8" required autofocus placeholder="At least 8 characters" />
          <p id="auth-error" class="error" role="alert"></p>
          <button class="primary full" type="submit">Unlock vault <span>↗</span></button>
        </form>
        <p class="footnote">Your master password is never stored. If you forget it, this vault cannot be decrypted.</p>
      </section>
    </main>`;
  document.querySelector<HTMLFormElement>("#unlock-form")!.addEventListener("submit", async event => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#master-password")!;
    const button = document.querySelector<HTMLButtonElement>("#unlock-form button")!;
    const error = document.querySelector<HTMLParagraphElement>("#auth-error")!;
    const password = input.value;
    button.disabled = true; button.textContent = "Unlocking…"; error.textContent = "";
    try {
      const raw = await window.moriVault.readVault();
      if (raw) {
        const result = await decryptVault(raw, password);
        vault = result.data; masterKey = result.key;
      } else {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        masterKey = await deriveKey(password, salt);
        vault = { schemaVersion: 1, entries: [] };
        await window.moriVault.writeVault(await encryptVault(vault, masterKey, salt));
      }
      renderVault();
    } catch {
      error.textContent = "Could not unlock the vault. Check your master password.";
      button.disabled = false; button.textContent = "Unlock vault ↗";
      input.focus();
    }
  });
}
async function saveVault(): Promise<void> {
  if (!vault || !masterKey) throw new Error("Vault is locked.");
  const raw = await window.moriVault.readVault();
  const salt = raw ? fromBase64((JSON.parse(raw) as EncryptedVault).salt) : crypto.getRandomValues(new Uint8Array(16));
  await window.moriVault.writeVault(await encryptVault(vault, masterKey, salt));
}
function renderVault(): void {
  if (!vault) return;
  const categories = ["All items", "Login", "Secure note", "Identity", "Card"];
  const filtered = vault.entries.filter(entry =>
    (selectedCategory === "All items" || entry.category === selectedCategory) &&
    [entry.title, entry.username, entry.url, entry.category].some(v => v.toLowerCase().includes(searchText.toLowerCase()))
  );
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark small">M</div><span>MoriVault</span><span class="lock-dot"></span></div>
        <p class="nav-label">YOUR VAULT</p>
        <nav>${categories.map(category => `<button class="nav-item ${selectedCategory === category ? "active" : ""}" data-category="${escapeHtml(category)}"><span class="nav-icon">${category === "All items" ? "▦" : category === "Login" ? "⌘" : "◇"}</span>${escapeHtml(category)}<span class="count">${category === "All items" ? vault!.entries.length : vault!.entries.filter(e => e.category === category).length}</span></button>`).join("")}</nav>
        <div class="sidebar-bottom"><div class="secure-status"><span class="status-indicator"></span><div><strong>Vault encrypted</strong><small>Stored on this device</small></div></div><button id="lock-button" class="text-button">Lock vault ↗</button></div>
      </aside>
      <main class="content">
        <header class="topbar"><div><p class="eyebrow">YOUR PRIVATE SPACE</p><h1>Good to see you.</h1></div><div class="avatar">MV</div></header>
        <section class="summary"><div><p class="eyebrow">VAULT OVERVIEW</p><h2>Everything in one secure place.</h2><p class="muted">Only you can unlock your encrypted information.</p></div><div class="summary-stat"><strong>${vault.entries.length.toString().padStart(2, "0")}</strong><span>saved items</span></div></section>
        <section class="items-section"><div class="section-heading"><div><h2>${escapeHtml(selectedCategory)}</h2><p class="muted">Your encrypted credentials and private notes</p></div><button id="add-button" class="primary">＋ Add item</button></div>
        <div class="search-wrap"><span>⌕</span><input id="search" placeholder="Search items…" value="${escapeHtml(searchText)}" /></div>
        <div class="items-list">${filtered.length ? filtered.map(entry => `<button class="item-row" data-entry="${entry.id}"><div class="item-icon">${escapeHtml((entry.title[0] || "?").toUpperCase())}</div><div class="item-main"><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.username || entry.url || entry.category)}</span></div><span class="item-type">${escapeHtml(entry.category)}</span><span class="chevron">›</span></button>`).join("") : `<div class="empty"><div class="empty-icon">◇</div><h3>No items yet</h3><p>Add your first secure item to get started.</p><button id="empty-add" class="secondary">＋ Create first item</button></div>`}</div>
        </section>
        <footer><span>● End-to-end encrypted locally</span><span>Storage providers · Coming soon</span></footer>
      </main>
    </div>`;
  document.querySelectorAll<HTMLButtonElement>("[data-category]").forEach(button => button.addEventListener("click", () => { selectedCategory = button.dataset.category || "All items"; renderVault(); }));
  document.querySelector<HTMLInputElement>("#search")!.addEventListener("input", event => { searchText = (event.target as HTMLInputElement).value; const pos = searchText.length; renderVault(); const input = document.querySelector<HTMLInputElement>("#search")!; input.focus(); input.setSelectionRange(pos, pos); });
  document.querySelector("#add-button")?.addEventListener("click", () => showEntryForm());
  document.querySelector("#empty-add")?.addEventListener("click", () => showEntryForm());
  document.querySelector("#lock-button")?.addEventListener("click", () => { vault = null; masterKey = null; showUnlock(); });
  document.querySelectorAll<HTMLButtonElement>("[data-entry]").forEach(button => button.addEventListener("click", () => showEntryForm(vault!.entries.find(e => e.id === button.dataset.entry))));
}
function showEntryForm(entry?: VaultEntry): void {
  if (!vault) return;
  const isEdit = Boolean(entry);
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="entry-title">
    <div class="modal-head"><div><p class="eyebrow">SECURE ITEM</p><h2 id="entry-title">${isEdit ? "Edit item" : "Add new item"}</h2></div><button class="icon-button" id="close-modal" aria-label="Close">×</button></div>
    <form id="entry-form">
      <label for="title">Title *</label><input id="title" required maxlength="120" value="${escapeHtml(entry?.title || "")}" placeholder="e.g. Personal email" />
      <div class="form-grid"><div><label for="username">Username / email</label><input id="username" autocomplete="off" value="${escapeHtml(entry?.username || "")}" /></div><div><label for="password">Password</label><input id="password" type="password" autocomplete="new-password" value="${escapeHtml(entry?.password || "")}" /></div></div>
      <label for="url">Website URL</label><input id="url" type="url" value="${escapeHtml(entry?.url || "")}" placeholder="https://" />
      <div class="form-grid"><div><label for="category">Category</label><select id="category">${["Login", "Secure note", "Identity", "Card"].map(c => `<option ${(entry?.category || "Login") === c ? "selected" : ""}>${c}</option>`).join("")}</select></div><div class="password-tools"><label>&nbsp;</label><button type="button" id="generate-password" class="secondary">Generate password</button></div></div>
      <label for="notes">Notes</label><textarea id="notes" rows="3">${escapeHtml(entry?.notes || "")}</textarea>
      <div class="modal-actions">${isEdit ? '<button type="button" id="delete-entry" class="danger">Delete item</button>' : '<span></span>'}<button type="button" id="cancel-modal" class="secondary">Cancel</button><button type="submit" class="primary">Save securely</button></div>
    </form></section>`;
  document.body.append(overlay);
  const close = () => overlay.remove();
  overlay.querySelector("#close-modal")!.addEventListener("click", close);
  overlay.querySelector("#cancel-modal")!.addEventListener("click", close);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  overlay.querySelector("#generate-password")!.addEventListener("click", () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_";
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const generated = Array.from(bytes, b => chars[b % chars.length]).join("");
    (overlay.querySelector<HTMLInputElement>("#password")!).value = generated;
    (overlay.querySelector<HTMLInputElement>("#password")!).type = "text";
  });
  overlay.querySelector("#delete-entry")?.addEventListener("click", async () => {
    if (!entry || !vault || !confirm("Delete this item permanently from the local vault?")) return;
    vault.entries = vault.entries.filter(e => e.id !== entry.id);
    await saveVault(); close(); renderVault();
  });
  overlay.querySelector<HTMLFormElement>("#entry-form")!.addEventListener("submit", async event => {
    event.preventDefault();
    const get = (id: string) => (overlay.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("#" + id)!).value.trim();
    const item: VaultEntry = { id: entry?.id || crypto.randomUUID(), title: get("title"), username: get("username"), password: get("password"), url: get("url"), category: get("category"), notes: get("notes"), updatedAt: new Date().toISOString() };
    if (!vault) return;
    if (entry) vault.entries = vault.entries.map(old => old.id === entry.id ? item : old);
    else vault.entries.unshift(item);
    await saveVault(); close(); renderVault();
  });
}

showUnlock();
