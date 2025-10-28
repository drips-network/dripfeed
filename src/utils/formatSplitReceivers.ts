type SplitsReceiver = {
  accountId: bigint;
  weight: number;
};

export function formatSplitReceivers(receivers: SplitsReceiver[]): SplitsReceiver[] {
  // Splits receivers must be sorted by user ID, deduplicated, and without weights <= 0.

  const seen = new Map<string, SplitsReceiver>();
  for (const receiver of receivers) {
    const key = `${receiver.accountId}:${receiver.weight}`;
    if (!seen.has(key)) {
      seen.set(key, receiver);
    }
  }
  const uniqueReceivers = Array.from(seen.values());

  const sortedReceivers = uniqueReceivers.sort((a, b) =>
    // Sort by user ID.

    BigInt(a.accountId) > BigInt(b.accountId)
      ? 1
      : BigInt(a.accountId) < BigInt(b.accountId)
        ? -1
        : 0,
  );

  return sortedReceivers;
}
