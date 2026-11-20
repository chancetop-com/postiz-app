export function selectedChannels<T extends { integration: { id: string } }>(
  channels: readonly T[],
  selected?: ReadonlySet<string>
) {
  return channels.filter(({ integration }) => !selected || selected.has(integration.id));
}
