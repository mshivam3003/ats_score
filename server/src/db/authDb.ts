import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config.js';

export interface UserRecord {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface OtpRecord {
  id: string;
  email: string;
  otpHash: string;
  expiresAt: number; // epoch ms
  attempts: number;
  used: boolean;
  createdAt: string;
}

const MAX_OTP_ATTEMPTS = 5;
const DEFAULT_OTP_TTL_MINUTES = 10;

function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

const usersFile = path.join(config.dataDir, 'users.json');
const otpsFile = path.join(config.dataDir, 'otps.json');

/** Atomic write to avoid corrupting database files */
function atomicWriteJson(filePath: string, data: unknown): void {
  ensureDataDir();
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  try {
    fs.renameSync(tmpPath, filePath);
  } catch {
    // Windows file rename fallback if destination exists or locked
    fs.copyFileSync(tmpPath, filePath);
    fs.unlinkSync(tmpPath);
  }
}

function readJsonFile<T>(filePath: string, defaultValue: T): T {
  ensureDataDir();
  if (!fs.existsSync(filePath)) {
    atomicWriteJson(filePath, defaultValue);
    return defaultValue;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp.trim()).digest('hex');
}

// ─── Users Repository ─────────────────────────────────────────────────────────

export function getAllUsers(): UserRecord[] {
  return readJsonFile<UserRecord[]>(usersFile, []);
}

export function findUserByEmail(email: string): UserRecord | null {
  const normalized = email.trim().toLowerCase();
  const users = getAllUsers();
  return users.find((u) => u.email.toLowerCase() === normalized) || null;
}

export function findUserById(id: string): UserRecord | null {
  const users = getAllUsers();
  return users.find((u) => u.id === id) || null;
}

export function upsertUser(email: string, name?: string): UserRecord {
  const normalized = email.trim().toLowerCase();
  const users = getAllUsers();
  const existingIndex = users.findIndex((u) => u.email.toLowerCase() === normalized);

  const now = new Date().toISOString();
  if (existingIndex >= 0) {
    const existing = users[existingIndex];
    existing.lastLoginAt = now;
    if (name) existing.name = name;
    users[existingIndex] = existing;
    atomicWriteJson(usersFile, users);
    return existing;
  }

  const newUser: UserRecord = {
    id: crypto.randomUUID(),
    email: normalized,
    name: name || normalized.split('@')[0],
    createdAt: now,
    lastLoginAt: now,
  };
  users.push(newUser);
  atomicWriteJson(usersFile, users);
  return newUser;
}

// ─── OTPs Repository ──────────────────────────────────────────────────────────

export function getAllOtps(): OtpRecord[] {
  return readJsonFile<OtpRecord[]>(otpsFile, []);
}

export function createOtp(email: string, plainOtp: string, ttlMinutes = DEFAULT_OTP_TTL_MINUTES): OtpRecord {
  const normalized = email.trim().toLowerCase();
  const otps = getAllOtps();

  // Invalidate any existing unused OTPs for this email
  for (const o of otps) {
    if (o.email.toLowerCase() === normalized && !o.used) {
      o.used = true;
    }
  }

  const newOtp: OtpRecord = {
    id: crypto.randomUUID(),
    email: normalized,
    otpHash: hashOtp(plainOtp),
    expiresAt: Date.now() + ttlMinutes * 60 * 1000,
    attempts: 0,
    used: false,
    createdAt: new Date().toISOString(),
  };

  otps.push(newOtp);
  atomicWriteJson(otpsFile, otps);
  return newOtp;
}

export function verifyOtp(
  email: string,
  plainOtp: string
): { success: boolean; error?: string } {
  const normalized = email.trim().toLowerCase();
  const otps = getAllOtps();

  // Find latest active OTP for this email
  const record = otps
    .filter((o) => o.email.toLowerCase() === normalized && !o.used)
    .sort((a, b) => b.expiresAt - a.expiresAt)[0];

  if (!record) {
    return { success: false, error: 'No active OTP found. Please request a new code.' };
  }

  if (Date.now() > record.expiresAt) {
    record.used = true;
    atomicWriteJson(otpsFile, otps);
    return { success: false, error: 'OTP has expired. Please request a new code.' };
  }

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    record.used = true;
    atomicWriteJson(otpsFile, otps);
    return { success: false, error: 'Too many incorrect attempts. Please request a new OTP.' };
  }

  const inputHash = hashOtp(plainOtp);
  if (inputHash !== record.otpHash) {
    record.attempts += 1;
    atomicWriteJson(otpsFile, otps);
    const remaining = MAX_OTP_ATTEMPTS - record.attempts;
    return {
      success: false,
      error: `Invalid OTP code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
    };
  }

  // OTP matched!
  record.used = true;
  atomicWriteJson(otpsFile, otps);
  return { success: true };
}

export function cleanExpiredOtps(): void {
  const otps = getAllOtps();
  const now = Date.now();
  // Keep only records newer than 24 hours
  const filtered = otps.filter((o) => now - o.expiresAt < 24 * 60 * 60 * 1000);
  if (filtered.length !== otps.length) {
    atomicWriteJson(otpsFile, filtered);
  }
}

