import type { EmailStatus } from "@/lib/types";

const statusConfig: Record<
  string,
  { bg: string; text: string; dot: string; label: string }
> = {
  SCHEDULED: {
    bg: "bg-scheduled-bg",
    text: "text-scheduled",
    dot: "bg-scheduled",
    label: "Scheduled",
  },
  PROCESSING: {
    bg: "bg-warning-bg",
    text: "text-warning",
    dot: "bg-warning",
    label: "Processing",
  },
  SENT: {
    bg: "bg-success-bg",
    text: "text-success",
    dot: "bg-success",
    label: "Sent",
  },
  FAILED: {
    bg: "bg-danger-bg",
    text: "text-danger",
    dot: "bg-danger",
    label: "Failed",
  },
  RATE_LIMITED: {
    bg: "bg-warning-bg",
    text: "text-warning",
    dot: "bg-warning",
    label: "Rate Limited",
  },
};

export function StatusBadge({ status }: { status: EmailStatus | string }) {
  const config = statusConfig[status] ?? {
    bg: "bg-surface-100",
    text: "text-muted",
    dot: "bg-muted",
    label: status,
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${config.bg} ${config.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
