import { localAccounts } from "@/db/schema";
import { runtimePlatform, runtimeValue } from "@/app/server/runtime-config";
import { getDb, getRunsBucket } from "@/runtime-db";

function response(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET() {
  const platform = runtimePlatform();
  if (
    platform === "node" &&
    runtimeValue("NODE_CONFIG_VALIDATED") !== "1"
  ) {
    return response(
      {
        status: "not_ready",
        ready: false,
        platform,
        reason: "production_configuration_not_validated",
      },
      503,
    );
  }

  try {
    await getDb()
      .select({ memberId: localAccounts.memberId })
      .from(localAccounts)
      .limit(1);
    getRunsBucket();
    return response({ status: "ok", ready: true, platform }, 200);
  } catch (error) {
    console.error("[health] persistence readiness check failed", error);
    return response(
      {
        status: "not_ready",
        ready: false,
        platform,
        reason: "persistence_unavailable",
      },
      503,
    );
  }
}
