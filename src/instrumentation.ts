export async function register(): Promise<void> {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_BUILD_WORKER === "1"
  ) {
    return;
  }

  const { startReadReceiptWorker } = await import(
    "@/modules/read-receipts/worker"
  );
  startReadReceiptWorker();
}
