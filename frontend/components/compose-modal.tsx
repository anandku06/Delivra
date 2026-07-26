"use client";

import { useState, useRef, useCallback } from "react";
import { scheduleEmails } from "@/lib/api";
import toast from "react-hot-toast";

interface ComposeModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function parseEmailsFromFile(content: string): string[] {
  const emailRegex = /[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/g;
  const matches = content.match(emailRegex) || [];
  return [...new Set(matches.map((e) => e.toLowerCase().trim()))];
}

export function ComposeModal({ onClose, onSuccess }: ComposeModalProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("");
  const [delayBetween, setDelayBetween] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(200);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get the minimum datetime (now)
  const getMinDateTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  };

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setFileName(file.name);

      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const parsed = parseEmailsFromFile(text);
        setRecipients(parsed);
        if (parsed.length === 0) {
          toast.error("No valid email addresses found in file");
        } else {
          toast.success(`Found ${parsed.length} email addresses`);
        }
      };
      reader.readAsText(file);
    },
    []
  );

  const handleManualAdd = () => {
    const emails = parseEmailsFromFile(recipientInput);
    if (emails.length === 0) {
      toast.error("No valid email addresses entered");
      return;
    }
    const merged = [...new Set([...recipients, ...emails])];
    setRecipients(merged);
    setRecipientInput("");
    toast.success(`Added ${emails.length} email(s). Total: ${merged.length}`);
  };

  const removeRecipient = (email: string) => {
    setRecipients((prev) => prev.filter((r) => r !== email));
  };

  const handleSubmit = async () => {
    if (!subject.trim()) {
      toast.error("Subject is required");
      return;
    }
    if (!body.trim()) {
      toast.error("Email body is required");
      return;
    }
    if (recipients.length === 0) {
      toast.error("Add at least one recipient");
      return;
    }
    if (!startTime) {
      toast.error("Start time is required");
      return;
    }
    if (new Date(startTime).getTime() < Date.now()) {
      toast.error("Start time cannot be in the past");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await scheduleEmails({
        subject: subject.trim(),
        body: body.trim(),
        recipients,
        startTime: new Date(startTime).toISOString(),
        delayBetweenEmails: delayBetween,
        hourlyLimit,
      });
      toast.success(result.message);
      onSuccess();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to schedule emails"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in" />

      {/* Modal */}
      <div
        className="relative bg-white rounded-2xl shadow-modal w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-border-light px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-surface-100 flex items-center justify-center text-muted hover:text-foreground transition-colors cursor-pointer"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
            </button>
            <h2 className="text-lg font-bold text-foreground">
              Compose New Email
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Recipients */}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">
              Recipients
            </label>
            <div className="flex gap-2 mb-2">
              <input
                id="recipient-input"
                type="text"
                placeholder="recipient@example.com"
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleManualAdd();
                  }
                }}
                className="flex-1 px-3.5 py-2.5 bg-surface-50 border border-border rounded-xl text-sm text-foreground placeholder:text-muted/60
                           focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500
                           transition-all"
              />
              <button
                onClick={handleManualAdd}
                className="px-4 py-2.5 bg-surface-100 text-foreground text-sm font-medium rounded-xl
                           hover:bg-surface-200 transition-colors cursor-pointer shrink-0"
              >
                Add
              </button>
            </div>

            {/* File upload */}
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                id="upload-csv-button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 border border-dashed border-surface-300 rounded-xl text-xs font-medium text-muted
                           hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50/30
                           transition-all cursor-pointer"
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
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                Upload CSV/TXT
              </button>
              {fileName && (
                <span className="text-xs text-muted">
                  📄 {fileName}
                </span>
              )}
            </div>

            {/* Recipient count & chips */}
            {recipients.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-brand-600">
                    {recipients.length} recipient{recipients.length !== 1 ? "s" : ""} added
                  </span>
                  <button
                    onClick={() => setRecipients([])}
                    className="text-xs text-danger hover:underline cursor-pointer"
                  >
                    Clear all
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {recipients.slice(0, 20).map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-50 text-brand-700 text-xs font-medium rounded-lg"
                    >
                      {email}
                      <button
                        onClick={() => removeRecipient(email)}
                        className="hover:text-danger transition-colors cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {recipients.length > 20 && (
                    <span className="text-xs text-muted px-2 py-0.5">
                      +{recipients.length - 20} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">
              Subject
            </label>
            <input
              id="email-subject"
              type="text"
              placeholder="Enter email subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-surface-50 border border-border rounded-xl text-sm text-foreground placeholder:text-muted/60
                         focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500
                         transition-all"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">
              Body
            </label>
            <textarea
              id="email-body"
              placeholder="Write your email content here..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              className="w-full px-3.5 py-2.5 bg-surface-50 border border-border rounded-xl text-sm text-foreground placeholder:text-muted/60
                         focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500
                         transition-all resize-none"
            />
          </div>

          {/* Schedule settings */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                Start Time
              </label>
              <input
                id="start-time"
                type="datetime-local"
                value={startTime}
                min={getMinDateTime()}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-surface-50 border border-border rounded-xl text-sm text-foreground
                           focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500
                           transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                Delay (seconds)
              </label>
              <input
                id="delay-between"
                type="number"
                min={0}
                value={delayBetween}
                onChange={(e) => setDelayBetween(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 bg-surface-50 border border-border rounded-xl text-sm text-foreground
                           focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500
                           transition-all"
              />
              <p className="text-xs text-muted mt-1">Between each email</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                Hourly Limit
              </label>
              <input
                id="hourly-limit"
                type="number"
                min={1}
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 bg-surface-50 border border-border rounded-xl text-sm text-foreground
                           focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500
                           transition-all"
              />
              <p className="text-xs text-muted mt-1">Max emails per hour</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-border-light px-6 py-4 flex items-center justify-between rounded-b-2xl">
          <div className="flex items-center gap-3">
            {/* Attachment icon */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-9 h-9 rounded-lg hover:bg-surface-100 flex items-center justify-center text-muted hover:text-foreground transition-colors cursor-pointer"
              title="Attach CSV"
            >
              <svg
                className="w-[18px] h-[18px]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                />
              </svg>
            </button>
            {/* Schedule icon */}
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-muted">
              <svg
                className="w-[18px] h-[18px]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>

          <button
            id="schedule-send-button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-brand-500 to-brand-600 text-white text-sm font-semibold rounded-xl
                       hover:from-brand-600 hover:to-brand-700 hover:shadow-[0_4px_12px_-2px_rgb(16_185_129/0.35)]
                       active:scale-[0.97]
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-200 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                Scheduling...
              </>
            ) : (
              <>
                Send
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
