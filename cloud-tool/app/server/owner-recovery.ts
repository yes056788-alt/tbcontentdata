import { sha256Hex } from "./auth-crypto";
import { ApiError } from "./http";
import {
  canonicalRecoveryTokenHash,
  recoveryCodeMatchesHash,
  recoverySecretMeetsPolicy,
} from "./owner-recovery-primitives";
import { runtimeValue } from "./runtime-config";

const MAX_RECOVERY_WINDOW_MILLISECONDS = 60 * 60 * 1000;

async function configuredRecovery() {
  const configuredHash = runtimeValue("OWNER_RECOVERY_TOKEN_HASH");
  const configuredSecret = runtimeValue("OWNER_RECOVERY_TOKEN");
  const configuredExpiry = runtimeValue("OWNER_RECOVERY_TOKEN_EXPIRES_AT");
  if (configuredHash && configuredSecret) {
    throw new ApiError(
      503,
      "OWNER_RECOVERY_MISCONFIGURED",
      "所有者恢复服务配置冲突，请联系部署管理员。",
    );
  }
  if (configuredHash) {
    const canonicalHash = canonicalRecoveryTokenHash(configuredHash);
    if (!canonicalHash) {
      throw new ApiError(
        503,
        "OWNER_RECOVERY_MISCONFIGURED",
        "所有者恢复服务配置无效，请联系部署管理员。",
      );
    }
    return {
      tokenHash: canonicalHash,
      expiresAt: recoveryExpiry(configuredExpiry),
    };
  }
  if (configuredSecret) {
    if (!recoverySecretMeetsPolicy(configuredSecret)) {
      throw new ApiError(
        503,
        "OWNER_RECOVERY_MISCONFIGURED",
        "所有者恢复服务配置无效，请联系部署管理员。",
      );
    }
    return {
      tokenHash: await sha256Hex(configuredSecret),
      expiresAt: recoveryExpiry(configuredExpiry),
    };
  }
  throw new ApiError(
    503,
    "OWNER_RECOVERY_NOT_CONFIGURED",
    "服务器尚未配置所有者恢复码，请联系部署管理员。",
  );
}

function recoveryExpiry(value: string | undefined) {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    throw new ApiError(
      503,
      "OWNER_RECOVERY_MISCONFIGURED",
      "所有者恢复码缺少有效期，请联系部署管理员。",
    );
  }
  const expiresAt = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(expiresAt)) {
    throw new ApiError(
      503,
      "OWNER_RECOVERY_MISCONFIGURED",
      "所有者恢复码有效期配置无效，请联系部署管理员。",
    );
  }
  if (expiresAt <= now) {
    throw new ApiError(
      410,
      "OWNER_RECOVERY_CODE_EXPIRED",
      "所有者恢复码已经过期，请让部署管理员生成新的恢复码。",
    );
  }
  if (expiresAt - now > MAX_RECOVERY_WINDOW_MILLISECONDS) {
    throw new ApiError(
      503,
      "OWNER_RECOVERY_MISCONFIGURED",
      "所有者恢复码有效期不能超过 60 分钟。",
    );
  }
  return expiresAt;
}

export async function verifyOwnerRecoveryCode(value: unknown) {
  const configured = await configuredRecovery();
  if (!(await recoveryCodeMatchesHash(value, configured.tokenHash))) {
    throw new ApiError(
      401,
      "INVALID_OWNER_RECOVERY_CODE",
      "所有者恢复码无效。",
    );
  }
  return configured;
}
