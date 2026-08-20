type DatabaseCheck = () => Promise<void>;

async function checkDatabase(): Promise<void> {
  const { prisma } = await import("@/lib/db");
  await prisma.$queryRaw`SELECT 1`;
}

export function createHealthHandler(databaseCheck: DatabaseCheck = checkDatabase) {
  return async function healthHandler(): Promise<Response> {
    try {
      await databaseCheck();

      return Response.json({ status: "ok" });
    } catch {
      return Response.json({ status: "unavailable" }, { status: 503 });
    }
  };
}

export const GET = createHealthHandler();
