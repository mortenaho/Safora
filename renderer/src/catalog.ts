export type CategoryId = "server" | "email" | "website" | "ftp" | "database";

export type FieldInput = "text" | "number" | "url" | "email" | "select" | "textarea";

export type FieldDef = {
  key: string;
  label: string;
  input?: FieldInput;
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
  wide?: boolean;
  options?: readonly string[];
  defaultValue?: string;
};

export type CategoryDef = {
  id: CategoryId;
  label: string;
  noun: string;
  description: string;
  fields: readonly FieldDef[];
};

export type VaultEntry = {
  id: string;
  category: CategoryId;
  title: string;
  fields: Record<string, string>;
  notes: string;
  updatedAt: string;
};

export type SyncProviderId = "onedrive" | "google-drive";

export type SyncSettings = {
  provider: SyncProviderId | null;
  folder: string;
};

export const SYNC_PROVIDERS: readonly { id: SyncProviderId; label: string; detail: string }[] = [
  {
    id: "onedrive",
    label: "OneDrive",
    detail: "Copy the encrypted vault into your OneDrive folder."
  },
  {
    id: "google-drive",
    label: "Google Drive",
    detail: "Copy the encrypted vault into your Google Drive folder."
  }
];

export function emptySync(): SyncSettings {
  return { provider: null, folder: "" };
}

export function isSyncProvider(value: unknown): value is SyncProviderId {
  return value === "onedrive" || value === "google-drive";
}

export type VaultData = {
  schemaVersion: 2;
  entries: VaultEntry[];
  sync: SyncSettings;
};

export const CATEGORIES: readonly CategoryDef[] = [
  {
    id: "server",
    label: "Server",
    noun: "server",
    description: "SSH hosts, admin users, and private keys",
    fields: [
      { key: "host", label: "Host / IP", required: true, placeholder: "10.0.0.12 or db.internal" },
      { key: "port", label: "Port", input: "number", placeholder: "22", defaultValue: "22" },
      { key: "username", label: "Username", placeholder: "root" },
      { key: "password", label: "Password", secret: true },
      { key: "os", label: "System", input: "select", options: ["Linux", "Windows", "macOS", "BSD", "Other"] },
      { key: "privateKey", label: "Private key", input: "textarea", secret: true, wide: true, placeholder: "Paste an SSH private key" }
    ]
  },
  {
    id: "email",
    label: "Email",
    noun: "mailbox",
    description: "Mailbox logins and IMAP / SMTP servers",
    fields: [
      { key: "email", label: "Email address", input: "email", required: true, wide: true, placeholder: "you@example.com" },
      { key: "username", label: "Username", placeholder: "If it differs from the address" },
      { key: "password", label: "Password", secret: true },
      { key: "imapHost", label: "IMAP host", placeholder: "imap.example.com" },
      { key: "imapPort", label: "IMAP port", input: "number", placeholder: "993", defaultValue: "993" },
      { key: "smtpHost", label: "SMTP host", placeholder: "smtp.example.com" },
      { key: "smtpPort", label: "SMTP port", input: "number", placeholder: "587", defaultValue: "587" }
    ]
  },
  {
    id: "website",
    label: "Website",
    noun: "website",
    description: "Site logins and the address they belong to",
    fields: [
      { key: "url", label: "Website URL", required: true, wide: true, placeholder: "https://example.com" },
      { key: "username", label: "Username", placeholder: "Name or email" },
      { key: "password", label: "Password", secret: true }
    ]
  },
  {
    id: "ftp",
    label: "FTP / SFTP",
    noun: "FTP / SFTP",
    description: "File transfer hosts, protocols, and remote paths",
    fields: [
      { key: "protocol", label: "Protocol", input: "select", options: ["SFTP", "FTP", "FTPS"], defaultValue: "SFTP" },
      { key: "port", label: "Port", input: "number", placeholder: "22", defaultValue: "22" },
      { key: "host", label: "Host", required: true, placeholder: "files.example.com" },
      { key: "username", label: "Username" },
      { key: "password", label: "Password", secret: true },
      { key: "remotePath", label: "Remote path", placeholder: "/var/www" }
    ]
  },
  {
    id: "database",
    label: "Database",
    noun: "database",
    description: "Engines, hosts, database names, and accounts",
    fields: [
      {
        key: "engine",
        label: "Engine",
        input: "select",
        options: ["PostgreSQL", "MySQL", "MariaDB", "SQL Server", "MongoDB", "Redis", "SQLite", "Other"],
        defaultValue: "PostgreSQL"
      },
      { key: "port", label: "Port", input: "number", placeholder: "5432", defaultValue: "5432" },
      { key: "host", label: "Host", placeholder: "Leave blank for a local SQLite file" },
      { key: "database", label: "Database name", required: true, placeholder: "Name or file path" },
      { key: "username", label: "Username" },
      { key: "password", label: "Password", secret: true }
    ]
  }
];

const FTP_PORT: Record<string, string> = { SFTP: "22", FTP: "21", FTPS: "990" };
const DB_PORT: Record<string, string> = {
  PostgreSQL: "5432",
  MySQL: "3306",
  MariaDB: "3306",
  "SQL Server": "1433",
  MongoDB: "27017",
  Redis: "6379",
  SQLite: "",
  Other: ""
};
const DB_SCHEME: Record<string, string> = {
  PostgreSQL: "postgresql",
  MySQL: "mysql",
  MariaDB: "mariadb",
  "SQL Server": "mssql",
  MongoDB: "mongodb",
  Redis: "redis",
  Other: "db"
};
const AUTO_PORTS = new Set(["", "21", "22", "990", "5432", "3306", "1433", "27017", "6379", "993", "587"]);

const CATEGORY_IDS = new Set<string>(CATEGORIES.map(category => category.id));

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === "string" && CATEGORY_IDS.has(value);
}

export function categoryById(id: CategoryId): CategoryDef {
  const found = CATEGORIES.find(category => category.id === id);
  if (!found) throw new Error("Unknown category");
  return found;
}

export function fieldSummary(id: CategoryId): string {
  return categoryById(id).fields.map(field => field.label).join(" · ");
}

export function blankFields(id: CategoryId): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of categoryById(id).fields) {
    if (field.defaultValue) fields[field.key] = field.defaultValue;
  }
  return fields;
}

export function suggestedPort(id: CategoryId, fields: Record<string, string>): string | undefined {
  if (id === "server") return "22";
  if (id === "ftp") return FTP_PORT[fields.protocol || "SFTP"] ?? "22";
  if (id === "database") return DB_PORT[fields.engine || "PostgreSQL"] ?? "";
  return undefined;
}

export function isAutoPort(value: string): boolean {
  return AUTO_PORTS.has(value.trim());
}

export function inputKind(field: FieldDef): "password" | FieldInput {
  if (field.secret && field.input !== "textarea") return "password";
  return field.input ?? "text";
}

function joinHost(host?: string, port?: string): string {
  const name = host?.trim() || "";
  const number = port?.trim() || "";
  if (!name) return "";
  return number ? `${name}:${number}` : name;
}

export function visibleFacts(entry: VaultEntry): { label: string; value: string }[] {
  const fields = entry.fields;
  const pairs: [string, string][] = [];
  const add = (label: string, value?: string) => {
    const text = value?.trim() || "";
    if (text) pairs.push([label, text]);
  };
  switch (entry.category) {
    case "server":
      add("Host", joinHost(fields.host, fields.port));
      add("User", fields.username);
      add("System", fields.os);
      break;
    case "email":
      add("Address", fields.email);
      add("IMAP", joinHost(fields.imapHost, fields.imapPort));
      add("SMTP", joinHost(fields.smtpHost, fields.smtpPort));
      break;
    case "website":
      add("URL", fields.url);
      add("User", fields.username);
      break;
    case "ftp":
      add("Protocol", fields.protocol);
      add("Host", joinHost(fields.host, fields.port));
      add("Path", fields.remotePath);
      break;
    case "database":
      add("Engine", fields.engine);
      add("Host", joinHost(fields.host, fields.port));
      add("Database", fields.database);
      break;
  }
  return pairs.slice(0, 3).map(([label, value]) => ({ label, value }));
}

export function connectionHint(id: CategoryId, fields: Record<string, string>): string {
  const host = fields.host?.trim() || "";
  const port = fields.port?.trim() || "";
  const user = fields.username?.trim() || "";
  switch (id) {
    case "server": {
      if (!host) return "ssh user@host";
      const target = user ? `${user}@${host}` : host;
      return port && port !== "22" ? `ssh ${target} -p ${port}` : `ssh ${target}`;
    }
    case "email":
      return fields.email?.trim() || "name@example.com";
    case "website":
      return fields.url?.trim() || "https://";
    case "ftp": {
      const protocol = (fields.protocol || "SFTP").toLowerCase();
      if (!host) return `${protocol}://host`;
      const auth = user ? `${user}@` : "";
      const path = fields.remotePath?.trim() || "";
      const suffix = path ? (path.startsWith("/") ? path : `/${path}`) : "";
      return `${protocol}://${auth}${host}${port ? `:${port}` : ""}${suffix}`;
    }
    case "database": {
      const engine = fields.engine || "PostgreSQL";
      if (engine === "SQLite") return fields.database?.trim() || "database file";
      const scheme = DB_SCHEME[engine] || "db";
      const name = fields.database?.trim() || "db";
      if (!host) return `${scheme}://host/${name}`;
      return `${scheme}://${user ? `${user}@` : ""}${host}${port ? `:${port}` : ""}/${name}`;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeEntry(value: unknown): VaultEntry {
  if (!isRecord(value)) throw new Error("Invalid vault contents.");
  const category: CategoryId = isCategoryId(value.category) ? value.category : "website";
  const rawFields = isRecord(value.fields) ? value.fields : {};
  const allowed = new Set(categoryById(category).fields.map(field => field.key));
  const fields: Record<string, string> = {};
  for (const [key, item] of Object.entries(rawFields)) {
    if (allowed.has(key) && typeof item === "string" && item.trim()) fields[key] = item;
  }
  return {
    id: asString(value.id) || crypto.randomUUID(),
    category,
    title: asString(value.title) || "Untitled",
    fields,
    notes: asString(value.notes),
    updatedAt: asString(value.updatedAt) || new Date().toISOString()
  };
}

function migrateLegacy(value: unknown): VaultEntry {
  if (!isRecord(value)) throw new Error("Invalid vault contents.");
  const previous = asString(value.category);
  const note = asString(value.notes);
  const imported = previous && previous !== "Login" ? `Imported from ${previous}` : "";
  return {
    id: asString(value.id) || crypto.randomUUID(),
    category: "website",
    title: asString(value.title) || "Untitled",
    fields: {
      ...(asString(value.url) ? { url: asString(value.url) } : {}),
      ...(asString(value.username) ? { username: asString(value.username) } : {}),
      ...(asString(value.password) ? { password: asString(value.password) } : {})
    },
    notes: [note, imported].filter(Boolean).join("\n"),
    updatedAt: asString(value.updatedAt) || new Date().toISOString()
  };
}

function normalizeSync(value: unknown): SyncSettings {
  if (!isRecord(value)) return emptySync();
  return {
    provider: isSyncProvider(value.provider) ? value.provider : null,
    folder: asString(value.folder).trim()
  };
}

export function normalizeVault(value: unknown): VaultData {
  if (!isRecord(value) || !Array.isArray(value.entries)) throw new Error("Invalid vault contents.");
  const sync = normalizeSync(value.sync);
  if (value.schemaVersion === 2) return { schemaVersion: 2, entries: value.entries.map(normalizeEntry), sync };
  if (value.schemaVersion === 1) return { schemaVersion: 2, entries: value.entries.map(migrateLegacy), sync: emptySync() };
  throw new Error("Invalid vault contents.");
}
