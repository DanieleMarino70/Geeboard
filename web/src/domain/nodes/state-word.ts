/* What a node's state is called, wherever it is shown. The Nodes page had the words and the dashboard did not: its node card was a dot, green or
   a pulsing amber, with the node's name and a ping, so an unreachable node looked like a degraded one and nobody who cannot tell the two colours
   apart could read it at all. */
export const NODE_STATE_WORD: Record<string, string> = {
  PENDING: "Pending approval",
  HEALTHY: "Healthy",
  DEGRADED: "Degraded",
  UNREACHABLE: "Unreachable",
  DRAINING: "Draining",
  MAINTENANCE: "Maintenance",
};
