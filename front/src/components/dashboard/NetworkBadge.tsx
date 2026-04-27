import { NETWORK_HEX, type Network } from "@/data/sample";

export function NetworkBadge({ network }: { network: Network }) {
  const color = NETWORK_HEX[network];
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `${color}26`,
        color,
        border: `1px solid ${color}55`,
      }}
    >
      {network}
    </span>
  );
}
