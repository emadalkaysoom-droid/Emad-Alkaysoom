import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AuthUser, NotificationItem, OmnixView, SubscriptionSummary, Workspace } from '../types/omnix';
import { TRANSLATIONS, type Lang } from '../i18n/translations';
import type { Procedural3DBlueprint, ProceduralWorldBlueprint } from '../../shared/procedural3d';

interface OmnixContextValue {
  activeView: OmnixView;
  setActiveView: (v: OmnixView) => void;
  language: Lang;
  setLanguage: (l: Lang) => void;
  t: (key: string) => string;
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  subscription: SubscriptionSummary | null;
  hasEntitlement: (key: string) => boolean;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  setActiveWorkspaceId: (id: string) => void;
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  activeThreeDBlueprint: Procedural3DBlueprint | null;
  setActiveThreeDBlueprint: (bp: Procedural3DBlueprint | null) => void;
  activeWorldBlueprint: ProceduralWorldBlueprint | null;
  setActiveWorldBlueprint: (w: ProceduralWorldBlueprint | null) => void;
  geminiConfigured: boolean;
  notifications: NotificationItem[];
  pendingApprovals: number;
  refreshSession: () => Promise<void>;
  refreshTick: number;
  triggerRefresh: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const OmnixContext = createContext<OmnixContextValue | null>(null);

export function OmnixProvider({ children }: { children: React.ReactNode }) {
  const [activeView, setActiveView] = useState<OmnixView>('home');
  const [language, setLanguageState] = useState<Lang>('en');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('ws-primary');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeThreeDBlueprint, setActiveThreeDBlueprint] = useState<Procedural3DBlueprint | null>(null);
  const [activeWorldBlueprint, setActiveWorldBlueprint] = useState<ProceduralWorldBlueprint | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<number>(0);
  const [refreshTick, setRefreshTick] = useState<number>(0);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  const setLanguage = useCallback((lang: Lang) => {
    setLanguageState(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, []);

  const t = useCallback(
    (key: string) => TRANSLATIONS[language][key] ?? key,
    [language]
  );

  const triggerRefresh = useCallback(() => {
    setRefreshTick((n) => n + 1);
  }, []);

  const hasEntitlement = useCallback(
    (key: string) => Boolean(subscription?.activeEntitlements?.includes(key)),
    [subscription]
  );

  const refreshSession = useCallback(async () => {
    try {
      const token = localStorage.getItem('omnix_token');
      const res = await fetch('/api/auth/session', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setSubscription(data.subscription || null);
        setWorkspaces(data.workspaces || []);
        setGeminiConfigured(Boolean(data.geminiConfigured));
      }
    } catch {
      // Ignore transient boot check
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession, refreshTick]);

  useEffect(() => {
    let cancelled = false;
    async function loadSummary() {
      try {
        const res = await fetch(`/api/dashboard?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          setNotifications(data.notifications || []);
          setPendingApprovals(data.pendingApprovals || 0);
        }
      } catch {
        // ignore
      }
    }
    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, refreshTick]);

  return (
    <OmnixContext.Provider
      value={{
        activeView,
        setActiveView,
        language,
        setLanguage,
        t,
        user,
        setUser,
        subscription,
        hasEntitlement,
        workspaces,
        activeWorkspaceId,
        setActiveWorkspaceId,
        activeProjectId,
        setActiveProjectId,
        activeConversationId,
        setActiveConversationId,
        activeThreeDBlueprint,
        setActiveThreeDBlueprint,
        activeWorldBlueprint,
        setActiveWorldBlueprint,
        geminiConfigured,
        notifications,
        pendingApprovals,
        refreshSession,
        refreshTick,
        triggerRefresh,
        sidebarOpen,
        setSidebarOpen,
      }}
    >
      {children}
    </OmnixContext.Provider>
  );
}

export function useOmnix() {
  const ctx = useContext(OmnixContext);
  if (!ctx) throw new Error('useOmnix must be used within OmnixProvider');
  return ctx;
}
