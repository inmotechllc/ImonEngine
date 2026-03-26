import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export async function hashControlRoomPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyControlRoomPassword(
  password: string,
  encodedHash: string
): Promise<boolean> {
  const [scheme, salt, stored] = encodedHash.split(":");
  if (scheme !== "scrypt" || !salt || !stored) {
    return false;
  }

  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const storedBuffer = Buffer.from(stored, "hex");
  if (storedBuffer.length !== derived.length) {
    return false;
  }

  return timingSafeEqual(storedBuffer, derived);
}

export interface ControlRoomSessionPayload {
  sub: "control-room-owner";
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

export function createSignedControlRoomSession(
  secret: string,
  ttlHours = 12
): string {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlHours * 60 * 60 * 1000);
  const payload: ControlRoomSessionPayload = {
    sub: "control-room-owner",
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    nonce: randomBytes(12).toString("hex")
  };
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return `${body}.${signature}`;
}

export function readSignedControlRoomSession(
  cookieValue: string | undefined,
  secret: string
): ControlRoomSessionPayload | undefined {
  if (!cookieValue) {
    return undefined;
  }

  const [body, signature] = cookieValue.split(".");
  if (!body || !signature) {
    return undefined;
  }

  const expectedSignature = createHmac("sha256", secret).update(body).digest("hex");
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (signatureBuffer.length !== expectedBuffer.length) {
    return undefined;
  }

  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return undefined;
  }

  const payload = JSON.parse(decodeBase64Url(body)) as ControlRoomSessionPayload;
  if (Number.isNaN(Date.parse(payload.expiresAt)) || Date.parse(payload.expiresAt) < Date.now()) {
    return undefined;
  }

  return payload;
}

export function createControlRoomDefaultSecret(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

