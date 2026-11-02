/**
 * persistence.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layered persistence strategy:
 *
 *  Layer            | Storage       | TTL / Scope
 *  ──────────────── | ───────────── | ──────────────────────────────────────
 *  User preferences | Cookie        | 365 days, survives restart
 *  Form inputs      | sessionStorage| Tab-session only (privacy-safe)
 *  AI results       | localStorage  | 7 days, survives refresh
 *  File objects     | in-memory     | Cannot be serialised; stays in RAM
 *
 * Keys are namespaced under "rr:" to avoid collisions.
 */

// ─── Cookie helpers ───────────────────────────────────────────────────────────

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year in seconds
const NS = "rr:";

export function setCookie(name: string, value: string, maxAge = COOKIE_MAX_AGE): void {
  const key = NS + name;
  document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
}

export function getCookie(name: string): string | null {
  const key = NS + name;
  const prefix = encodeURIComponent(key) + "=";
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

export function deleteCookie(name: string): void {
  const key = NS + name;
  document.cookie = `${encodeURIComponent(key)}=; max-age=0; path=/`;
}

// ─── localStorage helpers (with TTL) ─────────────────────────────────────────

const LS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface LsEntry<T> {
  v: T;
  exp: number; // expiry epoch ms
}

export function lsSet<T>(key: string, value: T, ttlMs = LS_TTL_MS): void {
  try {
    const entry: LsEntry<T> = { v: value, exp: Date.now() + ttlMs };
    localStorage.setItem(NS + key, JSON.stringify(entry));
  } catch {
    // Storage quota exceeded — clear expired entries and try once more
    lsClearExpired();
    try {
      const entry: LsEntry<T> = { v: value, exp: Date.now() + ttlMs };
      localStorage.setItem(NS + key, JSON.stringify(entry));
    } catch {
      console.warn(`localStorage quota hit; could not persist key "${key}"`);
    }
  }
}

export function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(NS + key);
    if (!raw) return null;
    const entry: LsEntry<T> = JSON.parse(raw);
    if (Date.now() > entry.exp) {
      localStorage.removeItem(NS + key);
      return null;
    }
    return entry.v;
  } catch {
    return null;
  }
}

export function lsRemove(key: string): void {
  try {
    localStorage.removeItem(NS + key);
  } catch { /* noop */ }
}

/** Remove all expired rr: entries from localStorage. */
export function lsClearExpired(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(NS)) continue;
      try {
        const entry: LsEntry<unknown> = JSON.parse(localStorage.getItem(k)!);
        if (Date.now() > entry.exp) toRemove.push(k);
      } catch {
        toRemove.push(k!);
      }
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch { /* noop */ }
}

// ─── sessionStorage helpers ───────────────────────────────────────────────────

export function ssSet<T>(key: string, value: T): void {
  try {
    sessionStorage.setItem(NS + key, JSON.stringify(value));
  } catch { /* noop */ }
}

export function ssGet<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(NS + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function ssRemove(key: string): void {
  try {
    sessionStorage.removeItem(NS + key);
  } catch { /* noop */ }
}

// ─── Clear all app data ───────────────────────────────────────────────────────

/** Wipe all ResumeRise data from every storage layer. */
export function clearAllPersistence(): void {
  // localStorage
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(NS)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch { /* noop */ }

  // sessionStorage
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(NS)) toRemove.push(k);
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* noop */ }

  // cookies
  try {
    for (const part of document.cookie.split(";")) {
      const name = part.trim().split("=")[0];
      if (decodeURIComponent(name).startsWith(NS)) {
        document.cookie = `${name}=; max-age=0; path=/`;
      }
    }
  } catch { /* noop */ }
}

