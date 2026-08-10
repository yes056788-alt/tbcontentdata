import { createHash } from "node:crypto";

const PLACEHOLDER_PATTERN =
  /(?:replace[-_ ]?with|change[-_ ]?me|changeme|placeholder|insert[-_ ]?here|your[-_ ]?(?:secret|key|token)|example(?:\.com)?|\$\{[^}]+\}|<[^>]+>)/i;

const PREDICTABLE_SEQUENCE_PATTERN =
  /(?:abcdefghijklmnopqrstuvwxyz|0123456789|qwertyuiop|asdfghjkl)/i;

function issue(name, code, message) {
  return { name, code, message };
}

function environmentValue(environment, name) {
  const value = environment[name];
  return typeof value === "string" ? value : "";
}

function secretIssue(environment, name, minimumLength) {
  const value = environmentValue(environment, name);
  if (!value) {
    return issue(name, "MISSING", `${name} is required.`);
  }
  const hasWhitespaceOrControl = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x20 || codePoint === 0x7f;
  });
  if (value !== value.trim() || hasWhitespaceOrControl) {
    return issue(
      name,
      "INVALID_CHARACTERS",
      `${name} must not contain whitespace or control characters.`,
    );
  }
  if (value.length < minimumLength || value.length > 4096) {
    return issue(
      name,
      "INVALID_LENGTH",
      `${name} must contain between ${minimumLength} and 4096 characters.`,
    );
  }
  if (
    PLACEHOLDER_PATTERN.test(value) ||
    PREDICTABLE_SEQUENCE_PATTERN.test(value) ||
    new Set(value).size < 10
  ) {
    return issue(
      name,
      "WEAK_OR_PLACEHOLDER",
      `${name} must be a high-entropy random value, not a template or predictable sequence.`,
    );
  }
  return null;
}

function publicOriginIssue(environment) {
  const value = environmentValue(environment, "APP_PUBLIC_ORIGIN");
  if (!value) {
    return issue(
      "APP_PUBLIC_ORIGIN",
      "MISSING",
      "APP_PUBLIC_ORIGIN is required for a production Node deployment.",
    );
  }
  if (value !== value.trim()) {
    return issue(
      "APP_PUBLIC_ORIGIN",
      "INVALID_ORIGIN",
      "APP_PUBLIC_ORIGIN must not contain surrounding whitespace.",
    );
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return issue(
      "APP_PUBLIC_ORIGIN",
      "INVALID_ORIGIN",
      "APP_PUBLIC_ORIGIN must be a valid HTTPS origin.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return issue(
      "APP_PUBLIC_ORIGIN",
      "HTTPS_ORIGIN_REQUIRED",
      "APP_PUBLIC_ORIGIN must be an HTTPS origin without credentials, path, query or fragment.",
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "example.com" ||
    hostname.endsWith(".example.com") ||
    hostname.endsWith(".example") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".test") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    PLACEHOLDER_PATTERN.test(hostname)
  ) {
    return issue(
      "APP_PUBLIC_ORIGIN",
      "PLACEHOLDER_ORIGIN",
      "APP_PUBLIC_ORIGIN must use the real production hostname, not a reserved example hostname.",
    );
  }
  return null;
}

function runDataKeyIssue(environment) {
  const name = "RUN_DATA_KEY";
  const value = environmentValue(environment, name);
  if (!value) return issue(name, "MISSING", `${name} is required.`);
  if (value !== value.trim() || PLACEHOLDER_PATTERN.test(value)) {
    return issue(
      name,
      "WEAK_OR_PLACEHOLDER",
      `${name} must be a freshly generated base64 key, not a template value.`,
    );
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    return issue(
      name,
      "INVALID_BASE64_KEY",
      `${name} must be canonical base64 for exactly 32 bytes.`,
    );
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value) {
    return issue(
      name,
      "INVALID_BASE64_KEY",
      `${name} must be canonical base64 for exactly 32 bytes.`,
    );
  }
  if (new Set(bytes).size < 12) {
    return issue(
      name,
      "WEAK_KEY",
      `${name} must be a high-entropy random 32-byte key.`,
    );
  }
  return null;
}

function ownerRecoveryIssues(environment) {
  const hashName = "OWNER_RECOVERY_TOKEN_HASH";
  const secretName = "OWNER_RECOVERY_TOKEN";
  const expiryName = "OWNER_RECOVERY_TOKEN_EXPIRES_AT";
  const hash = environmentValue(environment, hashName);
  const secret = environmentValue(environment, secretName);
  const expiry = environmentValue(environment, expiryName);
  if (!hash && !secret && !expiry) return [];
  const issues = [];
  if (hash && secret) {
    issues.push(issue(
      hashName,
      "CONFLICTING_VALUES",
      `Configure either ${hashName} or ${secretName}, never both.`,
    ));
  }
  if (hash) {
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      issues.push(issue(
        hashName,
        "INVALID_SHA256",
        `${hashName} must be a lowercase hexadecimal SHA-256 digest.`,
      ));
    }
  }
  if (secret) {
    const bytes = /^[A-Za-z0-9_-]{43}$/.test(secret)
      ? Buffer.from(secret, "base64url")
      : Buffer.alloc(0);
    if (
      bytes.length !== 32 ||
      bytes.toString("base64url") !== secret ||
      new Set(secret).size < 10
    ) {
      issues.push(issue(
        secretName,
        "INVALID_BASE64URL_TOKEN",
        `${secretName} must be canonical base64url for exactly 32 random bytes.`,
      ));
    }
  }
  if (!hash && !secret) {
    issues.push(issue(
      hashName,
      "MISSING",
      `${hashName} or ${secretName} is required when owner recovery is enabled.`,
    ));
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiry)
  ) {
    issues.push(issue(
      expiryName,
      "INVALID_EXPIRY",
      `${expiryName} must be a UTC RFC3339 timestamp.`,
    ));
  } else {
    const expiresAt = Date.parse(expiry);
    const remaining = expiresAt - Date.now();
    if (!Number.isFinite(expiresAt) || remaining <= 0 || remaining > 60 * 60 * 1000) {
      issues.push(issue(
        expiryName,
        "EXPIRY_WINDOW_INVALID",
        `${expiryName} must be in the future and no more than 60 minutes away.`,
      ));
    }
  }
  return issues;
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function validateNodeProductionConfig(environment = process.env) {
  const issues = [
    publicOriginIssue(environment),
    secretIssue(environment, "PASSWORD_PEPPER", 32),
    runDataKeyIssue(environment),
    secretIssue(environment, "BOOTSTRAP_TOKEN", 24),
    ...ownerRecoveryIssues(environment),
  ].filter(Boolean);
  const passwordPepper = environmentValue(environment, "PASSWORD_PEPPER");
  const bootstrapToken = environmentValue(environment, "BOOTSTRAP_TOKEN");
  if (passwordPepper && passwordPepper === bootstrapToken) {
    issues.push(
      issue(
        "BOOTSTRAP_TOKEN",
        "REUSED_SECRET",
        "BOOTSTRAP_TOKEN and PASSWORD_PEPPER must be generated independently.",
      ),
    );
  }
  const configuredRecoveryHash = environmentValue(
    environment,
    "OWNER_RECOVERY_TOKEN_HASH",
  );
  const recoverySecret = environmentValue(environment, "OWNER_RECOVERY_TOKEN");
  const recoveryFingerprint = configuredRecoveryHash ||
    (recoverySecret ? sha256Hex(recoverySecret) : "");
  const independentSecrets = [
    ["PASSWORD_PEPPER", passwordPepper],
    ["BOOTSTRAP_TOKEN", bootstrapToken],
    ["RUN_DATA_KEY", environmentValue(environment, "RUN_DATA_KEY")],
  ];
  if (
    recoveryFingerprint &&
    independentSecrets.some(([, value]) =>
      Boolean(value) && sha256Hex(value) === recoveryFingerprint)
  ) {
    issues.push(
      issue(
        configuredRecoveryHash
          ? "OWNER_RECOVERY_TOKEN_HASH"
          : "OWNER_RECOVERY_TOKEN",
        "REUSED_SECRET",
        "The owner recovery code must be generated independently from every other application secret.",
      ),
    );
  }
  return {
    ready: issues.length === 0,
    issues,
  };
}

export function assertNodeProductionConfig(environment = process.env) {
  const result = validateNodeProductionConfig(environment);
  if (result.ready) return;
  const summary = result.issues
    .map(({ name, code, message }) => `${name} [${code}]: ${message}`)
    .join("\n");
  const error = new Error(
    `Refusing to start the production Node server because its security configuration is not ready:\n${summary}`,
  );
  error.code = "NODE_PRODUCTION_CONFIG_INVALID";
  throw error;
}
