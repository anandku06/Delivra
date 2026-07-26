"use client";

import { JSX } from "react/jsx-runtime";
import type { TabType } from "./dashboard";

interface SidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  scheduledCount: number;
  sentCount: number;
}

export function Sidebar({
  activeTab,
  onTabChange,
  scheduledCount,
  sentCount,
}: SidebarProps) {
  const tabs: { id: TabType; label: string; count: number; icon: JSX.Element }[] = [
    {
      id: "scheduled",
      label: "Scheduled",
      count: scheduledCount,
      icon: (
        <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: "sent",
      label: "Sent",
      count: sentCount,
      icon: (
        <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      ),
    },
  ];

  return (
    <aside className="w-60 bg-white border-r border-border shrink-0 hidden md:flex flex-col">
      <nav className="flex flex-col gap-1 p-3 mt-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer group ${
                isActive
                  ? "bg-brand-50 text-brand-700"
                  : "text-muted hover:bg-surface-50 hover:text-foreground"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`transition-colors ${
                    isActive
                      ? "text-brand-600"
                      : "text-surface-300 group-hover:text-muted"
                  }`}
                >
                  {tab.icon}
                </span>
                {tab.label}
              </div>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full transition-colors ${
                  isActive
                    ? "bg-brand-100 text-brand-700"
                    : "bg-surface-100 text-muted"
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
