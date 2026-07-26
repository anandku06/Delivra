"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { getScheduledEmails, getSentEmails } from "@/lib/api";
import type { ScheduledEmail, SentEmail } from "@/lib/types";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { ScheduledTable } from "./scheduled-table";
import { SentTable } from "./sent-table";
import { ComposeModal } from "./compose-modal";
import toast from "react-hot-toast";

export type TabType = "scheduled" | "sent";

export function Dashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>("scheduled");
  const [scheduledEmails, setScheduledEmails] = useState<ScheduledEmail[]>([]);
  const [sentEmails, setSentEmails] = useState<SentEmail[]>([]);
  const [isLoadingScheduled, setIsLoadingScheduled] = useState(true);
  const [isLoadingSent, setIsLoadingSent] = useState(true);
  const [isComposeOpen, setIsComposeOpen] = useState(false);

  const fetchScheduled = useCallback(async () => {
    setIsLoadingScheduled(true);
    try {
      const data = await getScheduledEmails();
      setScheduledEmails(data);
    } catch {
      toast.error("Failed to load scheduled emails");
    } finally {
      setIsLoadingScheduled(false);
    }
  }, []);

  const fetchSent = useCallback(async () => {
    setIsLoadingSent(true);
    try {
      const data = await getSentEmails();
      setSentEmails(data);
    } catch {
      toast.error("Failed to load sent emails");
    } finally {
      setIsLoadingSent(false);
    }
  }, []);

  useEffect(() => {
    fetchScheduled();
    fetchSent();
  }, [fetchScheduled, fetchSent]);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchScheduled();
      fetchSent();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchScheduled, fetchSent]);

  const handleComposeSuccess = () => {
    setIsComposeOpen(false);
    fetchScheduled();
    fetchSent();
  };

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">
      <Header
        user={user!}
        onCompose={() => setIsComposeOpen(true)}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          scheduledCount={scheduledEmails.length}
          sentCount={sentEmails.length}
        />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-6 py-6">
            {activeTab === "scheduled" ? (
              <ScheduledTable
                emails={scheduledEmails}
                isLoading={isLoadingScheduled}
                onRefresh={fetchScheduled}
              />
            ) : (
              <SentTable
                emails={sentEmails}
                isLoading={isLoadingSent}
                onRefresh={fetchSent}
              />
            )}
          </div>
        </main>
      </div>

      {/* Compose Modal */}
      {isComposeOpen && (
        <ComposeModal
          onClose={() => setIsComposeOpen(false)}
          onSuccess={handleComposeSuccess}
        />
      )}
    </div>
  );
}
