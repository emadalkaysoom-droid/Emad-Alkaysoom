import React, { useState } from 'react';
import { Bell, Languages, Menu, Search, User } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';

export function TopBar() {
  const {
    t,
    language,
    setLanguage,
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    user,
    setUser,
    subscription,
    notifications,
    setActiveView,
    setSidebarOpen,
    triggerRefresh,
  } = useOmnix();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{
    projects: Array<{ id: string; name: string }>;
    memories: Array<{ id: string; title: string }>;
    files: Array<{ id: string; name: string }>;
  } | null>(null);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (q.trim().length < 2) {
      setSearchResults(null);
      return;
    }
    try {
      const res = await fetch(
        `/api/search?workspaceId=${encodeURIComponent(activeWorkspaceId)}&q=${encodeURIComponent(q)}`
      );
      if (res.ok) {
        setSearchResults(await res.json());
      }
    } catch {
      // ignore
    }
  };

  const switchRole = async (role: 'admin' | 'engineer' | 'analyst' | 'viewer') => {
    const res = await fetch('/api/auth/role-switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (res.ok) {
      const updated = await res.json();
      setUser(updated);
      triggerRefresh();
      setShowProfile(false);
    }
  };

  return (
    <header className="relative z-20 flex h-14 items-center justify-between gap-4 border-b border-slate-800/80 bg-[#0F141F] px-4 lg:px-6">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open navigation menu"
          className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>

        <span className="font-display text-sm font-bold tracking-wider text-slate-100 sm:hidden">
          OMNIX
        </span>

        <div className="relative hidden sm:block sm:w-64 lg:w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => void handleSearch(e.target.value)}
            placeholder={t('search_placeholder')}
            aria-label={t('search_placeholder')}
            className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] py-1.5 ps-9 pe-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500/60 focus:outline-none"
          />
          {searchResults && (
            <div className="absolute start-0 top-11 z-50 w-80 rounded-lg border border-slate-700 bg-[#131A29] p-3 shadow-xl text-xs">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                <span className="font-semibold text-slate-300">Search Results</span>
                <button
                  type="button"
                  onClick={() => {
                    setSearchResults(null);
                    setSearchQuery('');
                  }}
                  className="text-slate-400 hover:text-slate-200"
                >
                  Close
                </button>
              </div>
              {searchResults.projects.length === 0 &&
              searchResults.memories.length === 0 &&
              searchResults.files.length === 0 ? (
                <p className="text-slate-500">No matching workspace entities found.</p>
              ) : (
                <div className="space-y-2">
                  {searchResults.projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setActiveView('projects');
                        setSearchResults(null);
                      }}
                      className="block w-full text-start rounded px-2 py-1 text-slate-200 hover:bg-slate-800"
                    >
                      Project · {p.name}
                    </button>
                  ))}
                  {searchResults.memories.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setActiveView('memory');
                        setSearchResults(null);
                      }}
                      className="block w-full text-start rounded px-2 py-1 text-slate-200 hover:bg-slate-800"
                    >
                      Memory · {m.title}
                    </button>
                  ))}
                  {searchResults.files.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setActiveView('data');
                        setSearchResults(null);
                      }}
                      className="block w-full text-start rounded px-2 py-1 text-slate-200 hover:bg-slate-800"
                    >
                      File · {f.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        <label htmlFor="workspace-selector" className="sr-only">
          Workspace
        </label>
        <select
          id="workspace-selector"
          value={activeWorkspaceId}
          onChange={(e) => setActiveWorkspaceId(e.target.value)}
          className="hidden sm:block rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-slate-200 focus:border-sky-500/60 focus:outline-none"
        >
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
          className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0B0F17] px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white whitespace-nowrap shrink-0"
        >
          <Languages className="h-3.5 w-3.5 text-sky-400" />
          <span>{t('language_toggle')}</span>
        </button>

        <div className="relative">
          <button
            type="button"
            aria-label="Notifications"
            onClick={() => {
              setShowNotifs(!showNotifs);
              setShowProfile(false);
            }}
            className="relative flex items-center justify-center rounded-lg border border-slate-800 bg-[#0B0F17] p-2 text-slate-300 hover:border-slate-700 hover:text-white"
          >
            <Bell className="h-4 w-4" />
            {notifications.length > 0 && (
              <span className="ms-1 font-mono text-[11px] tabular-nums text-sky-400">
                {notifications.length}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute end-0 top-11 z-50 w-80 rounded-lg border border-slate-700 bg-[#131A29] p-3 shadow-xl">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs font-semibold text-slate-200">
                <span>Workspace Notifications</span>
                <button
                  type="button"
                  onClick={() => setShowNotifs(false)}
                  className="text-slate-400 hover:text-slate-200"
                >
                  Close
                </button>
              </div>
              {notifications.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">No unread system alerts.</p>
              ) : (
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {notifications.map((n) => (
                    <div key={n.id} className="border-b border-slate-800/70 pb-2 text-xs">
                      <p className="font-medium text-slate-200">{n.title}</p>
                      <p className="text-slate-400 mt-0.5">{n.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShowProfile(!showProfile);
              setShowNotifs(false);
            }}
            className="flex items-center gap-2 rounded-lg border border-slate-800 bg-[#0B0F17] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-700 whitespace-nowrap shrink-0"
          >
            <User className="h-3.5 w-3.5 text-sky-400" />
            <span className="hidden md:inline">{user?.full_name || user?.name || 'System Architect'}</span>
            <span className="hidden md:inline text-slate-600">·</span>
            <span className="hidden sm:inline font-mono text-slate-400">{user?.account_role || user?.role || 'admin'}</span>
          </button>

          {showProfile && (
            <div className="absolute end-0 top-11 z-50 w-64 rounded-lg border border-slate-700 bg-[#131A29] p-3 shadow-xl text-xs">
              <p className="font-semibold text-slate-200">{user?.full_name || user?.name}</p>
              <p className="text-slate-400">{user?.email}</p>
              <div className="mt-2 mb-3 flex items-center justify-between border-y border-slate-800 py-2">
                <span className="text-slate-400">Plan</span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveView('billing');
                    setShowProfile(false);
                  }}
                  className="font-mono font-semibold text-amber-300 hover:underline"
                >
                  {subscription?.isPremiumActive ? 'PREMIUM ($5/3mo)' : 'FREE · Upgrade'}
                </button>
              </div>
              <div className="flex gap-1.5 mb-3">
                <button
                  type="button"
                  onClick={() => {
                    setActiveView('account');
                    setShowProfile(false);
                  }}
                  className="flex-1 rounded border border-slate-700 bg-slate-800/70 px-2 py-1.5 text-center font-medium text-slate-200 hover:bg-slate-800"
                >
                  {t('nav_account')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveView('billing');
                    setShowProfile(false);
                  }}
                  className="flex-1 rounded border border-sky-500/40 bg-sky-500/15 px-2 py-1.5 text-center font-medium text-sky-300 hover:bg-sky-500/25"
                >
                  {t('nav_billing')}
                </button>
              </div>
              <p className="text-slate-400 mb-1.5 font-medium">Active RBAC Role</p>
              <div className="grid grid-cols-2 gap-1.5">
                {(['admin', 'engineer', 'analyst', 'viewer'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => void switchRole(r)}
                    className={`rounded px-2 py-1.5 text-start font-mono capitalize transition-colors ${
                      user?.role === r
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                        : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
