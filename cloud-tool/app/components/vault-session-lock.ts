const BRIDGE_CHANNEL = "taobao-full-chain-tool-v1";

type VaultLockSync = {
  lockAccountVault?: () => Promise<unknown>;
};

type VaultLockWindow = Window & {
  TaobaoCloudSync?: VaultLockSync;
};

function successfulLockResponse(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return response.ok !== false && response.locked === true;
}

export async function lockAccountVaultSession(timeoutMs = 1200): Promise<boolean> {
  const lockWindow = window as VaultLockWindow;
  if (typeof lockWindow.TaobaoCloudSync?.lockAccountVault === "function") {
    try {
      const response = await lockWindow.TaobaoCloudSync.lockAccountVault();
      return successfulLockResponse(response);
    } catch {
      return false;
    }
  }

  return new Promise<boolean>((resolve) => {
    const requestId = `vault-lock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    let settled = false;
    const finish = (locked: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(locked);
    };
    const onMessage = (event: MessageEvent) => {
      const message = event.data as Record<string, unknown> | null;
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        !message ||
        message.channel !== BRIDGE_CHANNEL ||
        message.type !== "response" ||
        message.requestId !== requestId
      ) return;
      const data = message.data && typeof message.data === "object" && !Array.isArray(message.data)
        ? message.data as Record<string, unknown>
        : {};
      finish(message.ok === true && data.locked === true);
    };
    const timer = window.setTimeout(() => finish(false), Math.max(1, timeoutMs));
    window.addEventListener("message", onMessage);
    window.postMessage({
      channel: BRIDGE_CHANNEL,
      type: "request",
      requestId,
      action: "lockAccountVault",
      payload: {},
    }, window.location.origin);
  });
}

export async function lockVaultAndRedirect(path: string, timeoutMs = 1200) {
  const locked = await lockAccountVaultSession(timeoutMs);
  window.location.replace(path);
  return { locked };
}
