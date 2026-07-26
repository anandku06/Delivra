"use client";

import type { SentEmail } from "@/lib/types";
import { StatusBadge } from "./status-badge";
import { EmptyState, TableSkeleton } from "./empty-state";

interface SentTableProps {
  emails: SentEmail[];
  isLoading: boolean;
  onRefresh: () => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function SentTable({ emails, isLoading, onRefresh }: SentTableProps) {
  return (
    <div className="animate-fade-in">
      {/* Section header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-foreground">Sent Emails</h2>
          <p className="text-sm text-muted mt-0.5">
            History of sent and failed emails
          </p>
        </div>
        <button
          id="refresh-sent-button"
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
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            }
            title="No sent emails yet"
            description="Emails will appear here once they've been sent."
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
                    Sent At
                  </th>
                  <th className="text-left text-xs font-semibold text-muted uppercase tracking-wider px-5 py-3.5">
                    Status
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
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            email.status === "SENT"
                              ? "bg-success-bg text-success"
                              : "bg-danger-bg text-danger"
                          }`}
                        >
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
                        {formatDate(email.sentAt)}
                      </div>
                      {email.sentAt && (
                        <div className="text-xs text-muted">
                          {formatTime(email.sentAt)}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={email.status} />
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
