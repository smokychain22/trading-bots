import type { IncomingMessage, ServerResponse } from "node:http";
import type { CustomerIdentity, CustomerStore } from "./customer-store.js";
import {
  hashPassword,
  randomOpaqueToken,
  sha256,
  verifyPassword,
} from "./customer-security.js";

const cookieName = "tb_customer";
const sessionLifetimeMs = 7 * 24 * 60 * 60_000;

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("EMAIL_INVALID");
  }
  return email;
}

export function customerSessionToken(request: IncomingMessage): string | null {
  return request.headers.cookie
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1) ?? null;
}

export async function currentCustomer(
  request: IncomingMessage,
  store: CustomerStore,
): Promise<CustomerIdentity | null> {
  const token = customerSessionToken(request);
  return token ? store.getSession(sha256(token), new Date()) : null;
}

export async function createCustomerSession(
  response: ServerResponse,
  store: CustomerStore,
  customerId: string,
  production = process.env.NODE_ENV === "production",
): Promise<void> {
  const token = randomOpaqueToken();
  await store.createSession(
    customerId,
    sha256(token),
    new Date(Date.now() + sessionLifetimeMs),
  );
  response.setHeader(
    "Set-Cookie",
    `${cookieName}=${token}; HttpOnly; ${production ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}`,
  );
}

export async function registerCustomer(
  response: ServerResponse,
  store: CustomerStore,
  emailValue: string,
  password: string,
): Promise<CustomerIdentity> {
  const email = normalizeEmail(emailValue);
  const customer = await store.createCustomer(email, await hashPassword(password));
  await createCustomerSession(response, store, customer.customerId);
  return customer;
}

export async function loginCustomer(
  response: ServerResponse,
  store: CustomerStore,
  emailValue: string,
  password: string,
): Promise<CustomerIdentity | null> {
  const email = normalizeEmail(emailValue);
  const customer = await store.findCustomerByEmail(email);
  if (!customer || !(await verifyPassword(password, customer.passwordHash))) return null;
  await createCustomerSession(response, store, customer.customerId);
  return customer;
}

export async function logoutCustomer(
  request: IncomingMessage,
  response: ServerResponse,
  store: CustomerStore,
): Promise<void> {
  const token = customerSessionToken(request);
  if (token) await store.revokeSession(sha256(token));
  response.setHeader(
    "Set-Cookie",
    `${cookieName}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

