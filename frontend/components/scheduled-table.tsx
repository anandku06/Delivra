"use client";

import { useState } from "react";
import type { ScheduledEmail } from "@/lib/types";
import { deleteScheduledEmailApi } from "@/lib/api";
import { StatusBadge } from "./status-badge";
import { EmptyState, TableSkeleton } from "./empty-state";
import toast from "react-hot-toast";

interface ScheduledTableProps {
  emails: ScheduledEmail[];
  isLoading: boolean;
  onRefresh: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function ScheduledTable({
  emails,
  isLoading,
  onRefresh,
}: ScheduledTableProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (emailId: string) => {
    if (deletingId) return;

    setDeletingId(emailId);
    try {
      await deleteScheduledEmailApi(emailId);
      toast.success("Email deleted");
      onRefresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete email"
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="animate-fade-in">
      {/* Section header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-foreground">
            Scheduled Emails
          </h2>
          <p className="text-sm text-muted mt-0.5">
            Emails pending to be sent
          </p>
        </div>
        <button
          id="refresh-scheduled-button"
          onClick={onRefresh}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-surface-100 transition-all cursor-pointer"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh
        </button>
      </div>

      {/* Table card */}
      <div className="bg-white rounded-2xl border border-border shadow-card overflow-hidden">
        {isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={5} />
          </div>
        ) : emails.length === 0 ? (
          <EmptyState
            icon={
              <svg
                className="w-8 h-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            }
            title="No scheduled emails"
            description="When you schedule emails, they'll appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-light">
                  <th className="text-left text-xs font-semibold text-muted uppercase tracking-wider px-5 py-3.5">
                    Recipient
                  </th>
                  <th className="text-left text-xs font-semibold text-muted uppercase tracking-wider px-5 py-3.5">
                    Subject
                  </th>
                  <th className="text-left text-xs font-semibold text-muted uppercase tracking-wider px-5 py-3.5">
                    Scheduled Time
                  </th>
                  <th className="text-left text-xs font-semibold text-muted uppercase tracking-wider px-5 py-3.5">
                    Status
                  </th>
                  <th className="text-right text-xs font-semibold text-muted uppercase tracking-wider px-5 py-3.5">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {emails.map((email, idx) => (
                  <tr
                    key={email.id}
                    className="hover:bg-surface-50/50 transition-colors animate-slide-up"
                    style={{ animationDelay: `${idx * 0.03}s` }}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-accent-50 flex items-center justify-center text-accent-600 text-xs font-bold shrink-0">
                          {email.recipient.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-foreground truncate max-w-[200px]">
                          {email.recipient}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-foreground/80 truncate max-w-[250px] block">
                        {email.subject}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="text-sm text-foreground/80">
                        {formatDate(email.scheduledTime)}
                      </div>
                      <div className="text-xs text-muted">
                        {formatTime(email.scheduledTime)}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={email.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => handleDelete(email.id)}
                        disabled={deletingId === email.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger-bg rounded-lg
                                   disabled:opacity-50 disabled:cursor-not-allowed
                                   transition-all cursor-pointer"
                        title="Delete scheduled email"
                      >
                        {deletingId === email.id ? (
                          <div className="w-3.5 h-3.5 border-2 border-danger/40 border-t-danger rounded-full animate-spin" />
                        ) : (
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        )}
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
