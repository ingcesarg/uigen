import { test, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { mockSign, mockSetProtectedHeader, mockSetExpirationTime, mockSetIssuedAt, mockSet, mockGet, mockCookies, mockJwtVerify } = vi.hoisted(() => {
  const mockSign = vi.fn();
  const mockSetProtectedHeader = vi.fn();
  const mockSetExpirationTime = vi.fn();
  const mockSetIssuedAt = vi.fn();
  const mockSet = vi.fn();
  const mockGet = vi.fn();
  const mockCookies = vi.fn();
  const mockJwtVerify = vi.fn();

  return {
    mockSign,
    mockSetProtectedHeader,
    mockSetExpirationTime,
    mockSetIssuedAt,
    mockSet,
    mockGet,
    mockCookies,
    mockJwtVerify,
  };
});

vi.mock("jose", () => ({
  SignJWT: vi.fn().mockImplementation(() => ({
    setProtectedHeader: mockSetProtectedHeader.mockReturnThis(),
    setExpirationTime: mockSetExpirationTime.mockReturnThis(),
    setIssuedAt: mockSetIssuedAt.mockReturnThis(),
    sign: mockSign,
  })),
  jwtVerify: mockJwtVerify,
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

import { createSession, getSession } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
  mockCookies.mockResolvedValue({
    set: mockSet,
    get: mockGet,
    delete: vi.fn(),
  });
  mockSign.mockResolvedValue("mock-jwt-token");
});

test("createSession creates JWT with correct payload", async () => {
  const { SignJWT } = await import("jose");

  await createSession("user123", "test@example.com");

  expect(SignJWT).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: "user123",
      email: "test@example.com",
      expiresAt: expect.any(Date),
    })
  );
});

test("createSession sets JWT header with HS256 algorithm", async () => {
  await createSession("user123", "test@example.com");

  expect(mockSetProtectedHeader).toHaveBeenCalledWith({ alg: "HS256" });
});

test("createSession sets JWT expiration to 7 days", async () => {
  await createSession("user123", "test@example.com");

  expect(mockSetExpirationTime).toHaveBeenCalledWith("7d");
});

test("createSession sets JWT issued at timestamp", async () => {
  await createSession("user123", "test@example.com");

  expect(mockSetIssuedAt).toHaveBeenCalled();
});

test("createSession signs JWT with secret", async () => {
  await createSession("user123", "test@example.com");

  expect(mockSign).toHaveBeenCalled();
  const callArg = mockSign.mock.calls[0][0];
  expect(callArg.constructor.name).toBe("Uint8Array");
  expect(callArg.byteLength).toBeGreaterThan(0);
});

test("createSession sets cookie with correct name and token", async () => {
  await createSession("user123", "test@example.com");

  expect(mockSet).toHaveBeenCalledWith(
    "auth-token",
    "mock-jwt-token",
    expect.any(Object)
  );
});

test("createSession sets cookie with httpOnly flag", async () => {
  await createSession("user123", "test@example.com");

  expect(mockSet).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    expect.objectContaining({
      httpOnly: true,
    })
  );
});

test("createSession sets cookie with sameSite lax", async () => {
  await createSession("user123", "test@example.com");

  expect(mockSet).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    expect.objectContaining({
      sameSite: "lax",
    })
  );
});

test("createSession sets cookie with root path", async () => {
  await createSession("user123", "test@example.com");

  expect(mockSet).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    expect.objectContaining({
      path: "/",
    })
  );
});

test("createSession sets cookie with 7-day expiration", async () => {
  const beforeCall = Date.now();
  await createSession("user123", "test@example.com");
  const afterCall = Date.now();

  const cookieOptions = mockSet.mock.calls[0][2];
  const expiresTime = cookieOptions.expires.getTime();
  const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;

  expect(expiresTime).toBeGreaterThanOrEqual(beforeCall + sevenDaysInMs);
  expect(expiresTime).toBeLessThanOrEqual(afterCall + sevenDaysInMs);
});

test("createSession sets secure flag to false in development", async () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";

  await createSession("user123", "test@example.com");

  expect(mockSet).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    expect.objectContaining({
      secure: false,
    })
  );

  process.env.NODE_ENV = originalEnv;
});

test("createSession sets secure flag to true in production", async () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  await createSession("user123", "test@example.com");

  expect(mockSet).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    expect.objectContaining({
      secure: true,
    })
  );

  process.env.NODE_ENV = originalEnv;
});

test("createSession calls cookies() to get cookie store", async () => {
  await createSession("user123", "test@example.com");

  expect(mockCookies).toHaveBeenCalled();
});

test("getSession returns session payload when valid token exists", async () => {
  const mockPayload = {
    userId: "user123",
    email: "test@example.com",
    expiresAt: new Date("2025-12-31"),
  };

  mockGet.mockReturnValue({ value: "valid-token" });
  mockJwtVerify.mockResolvedValue({ payload: mockPayload });

  const result = await getSession();

  expect(result).toEqual(mockPayload);
  expect(mockCookies).toHaveBeenCalled();
  expect(mockGet).toHaveBeenCalledWith("auth-token");
  expect(mockJwtVerify).toHaveBeenCalled();
  expect(mockJwtVerify.mock.calls[0][0]).toBe("valid-token");
});

test("getSession returns null when no token exists", async () => {
  mockGet.mockReturnValue(undefined);

  const result = await getSession();

  expect(result).toBeNull();
  expect(mockCookies).toHaveBeenCalled();
  expect(mockGet).toHaveBeenCalledWith("auth-token");
  expect(mockJwtVerify).not.toHaveBeenCalled();
});

test("getSession returns null when token verification fails", async () => {
  mockGet.mockReturnValue({ value: "invalid-token" });
  mockJwtVerify.mockRejectedValue(new Error("Invalid token"));

  const result = await getSession();

  expect(result).toBeNull();
  expect(mockJwtVerify).toHaveBeenCalled();
  expect(mockJwtVerify.mock.calls[0][0]).toBe("invalid-token");
});

test("getSession calls jwtVerify with correct secret", async () => {
  mockGet.mockReturnValue({ value: "test-token" });
  mockJwtVerify.mockResolvedValue({ payload: { userId: "123", email: "test@test.com", expiresAt: new Date() } });

  await getSession();

  const secretArg = mockJwtVerify.mock.calls[0][1];
  expect(secretArg.constructor.name).toBe("Uint8Array");
  expect(secretArg.byteLength).toBeGreaterThan(0);
});
