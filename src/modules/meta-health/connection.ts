export type MetaConnectionState = "UNKNOWN" | "CONNECTED" | "DISCONNECTED";

export type ConnectionEvidence = {
  connectionState: MetaConnectionState;
  connectionObservedAt: Date | null;
  connectionReason: string | null;
};

export type GraphConnection = {
  status: string | null;
  platformType: string | null;
  isOnBizApp: boolean | null;
  subscribed?: boolean | null;
};

export function connectionFromGraph(remote: GraphConnection, startedAt: Date): ConnectionEvidence {
  const state = remote.status === "DISCONNECTED" || remote.subscribed === false ? "DISCONNECTED"
    : remote.status === "CONNECTED" && remote.platformType === "CLOUD_API" && remote.isOnBizApp === true && remote.subscribed === true
      ? "CONNECTED" : "UNKNOWN";
  return { connectionState: state, connectionObservedAt: startedAt, connectionReason: remote.subscribed === false ? "WEBHOOK_CONFIGURATION_REQUIRED" : `GRAPH_${state}` };
}

export function connectionFromEvent(event: string, occurredAt: Date): ConnectionEvidence | null {
  if (event === "ACCOUNT_OFFBOARDED" || event === "PARTNER_REMOVED") {
    return { connectionState: "DISCONNECTED", connectionObservedAt: occurredAt, connectionReason: event };
  }
  if (event === "ACCOUNT_RECONNECTED") {
    return { connectionState: "UNKNOWN", connectionObservedAt: occurredAt, connectionReason: "RECONNECT_PENDING" };
  }
  return null;
}

export function mergeConnectionEvidence(
  current: Omit<ConnectionEvidence, "connectionState"> & { connectionState: string },
  incoming: ConnectionEvidence,
): ConnectionEvidence | null {
  // Meta lifecycle timestamps have second precision; a disconnection wins the entire second.
  const previousTime = Math.floor((current.connectionObservedAt?.getTime() ?? -Infinity) / 1000);
  const nextTime = Math.floor((incoming.connectionObservedAt?.getTime() ?? -Infinity) / 1000);
  if (nextTime < previousTime || (nextTime === previousTime && incoming.connectionState !== "DISCONNECTED")) return null;
  // A notification or incomplete read cannot clear a confirmed outage.
  if (incoming.connectionState === "UNKNOWN" && current.connectionState === "DISCONNECTED") {
    return { ...incoming, connectionState: "DISCONNECTED", connectionReason: current.connectionReason };
  }
  return incoming;
}
