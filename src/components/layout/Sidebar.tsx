import React from 'react';
import {
  Activity,
  BarChart3,
  Bot,
  Box,
  Code2,
  Compass,
  Cpu,
  Crown,
  Dna,
  Eye,
  FlaskConical,
  FolderKanban,
  Globe,
  Hammer,
  Home,
  Languages,
  LayoutGrid,
  Mic,
  Network,
  Plug,
  Radar,
  Settings,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import type { OmnixView } from '../../types/omnix';

interface NavItem {
  id: OmnixView;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
}

const CORE_ITEMS: NavItem[] = [
  { id: 'home', labelKey: 'nav_home', icon: Home },
  { id: 'onboarding', labelKey: 'nav_onboarding', icon: Compass },
  { id: 'assistant', labelKey: 'nav_assistant', icon: Cpu },
  { id: 'projects', labelKey: 'nav_projects', icon: FolderKanban },
  { id: 'agents', labelKey: 'nav_agents', icon: Bot },
  { id: 'vision', labelKey: 'nav_vision', icon: Eye },
  { id: 'voice', labelKey: 'nav_voice', icon: Mic },
  { id: 'memory', labelKey: 'nav_memory', icon: Network },
  { id: 'studio3d', labelKey: 'nav_studio3d', icon: Box },
  { id: 'simulation', labelKey: 'nav_simulation', icon: LayoutGrid },
  { id: 'world', labelKey: 'nav_world', icon: Globe },
  { id: 'data', labelKey: 'nav_data', icon: BarChart3 },
];

const EXPANSION_ITEMS: NavItem[] = [
  { id: 'codex', labelKey: 'nav_codex', icon: Code2 },
  { id: 'genome', labelKey: 'nav_genome', icon: Dna },
  { id: 'lab', labelKey: 'nav_lab', icon: FlaskConical },
  { id: 'radar', labelKey: 'nav_radar', icon: Radar },
  { id: 'translator', labelKey: 'nav_translator', icon: Languages },
  { id: 'autobuild', labelKey: 'nav_autobuild', icon: Hammer },
];

const PLATFORM_ITEMS: NavItem[] = [
  { id: 'account', labelKey: 'nav_account', icon: UserCheck },
  { id: 'billing', labelKey: 'nav_billing', icon: Crown },
  { id: 'integrations', labelKey: 'nav_integrations', icon: Plug },
  { id: 'security', labelKey: 'nav_security', icon: ShieldCheck },
  { id: 'settings', labelKey: 'nav_settings', icon: Settings },
  { id: 'health', labelKey: 'nav_health', icon: Activity },
];

export function Sidebar() {
  const { activeView, setActiveView, t, pendingApprovals, sidebarOpen, setSidebarOpen, subscription } = useOmnix();

  const handleSelect = (id: OmnixView) => {
    setActiveView(id);
    setSidebarOpen(false);
  };

  const renderSection = (titleKey: string, items: NavItem[]) => (
    <div className="mb-4">
      <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {t(titleKey)}
      </div>
      <div className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item.id)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-500 ${
                isActive
                  ? 'bg-sky-500/12 text-sky-300 border border-sky-500/25'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100 border border-transparent'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-sky-400' : 'text-slate-500'}`} />
                <span className="truncate">{t(item.labelKey)}</span>
              </span>
              {item.id === 'security' && pendingApprovals > 0 && (
                <span className="font-mono text-xs tabular-nums text-amber-400">
                  {pendingApprovals}
                </span>
              )}
              {item.id === 'billing' && (
                <span className={`font-mono text-[10px] uppercase ${subscription?.isPremiumActive ? 'text-amber-300' : 'text-slate-500'}`}>
                  {subscription?.isPremiumActive ? 'PRO' : 'FREE'}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Primary Navigation"
        className={`fixed inset-y-0 start-0 z-40 flex w-64 flex-col border-e border-slate-800/80 bg-[#0F141F] transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full lg:rtl:translate-x-0'
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-800/80 px-5">
          <button
            type="button"
            onClick={() => handleSelect('home')}
            className="flex items-center gap-2.5 text-start focus-visible:outline-2 focus-visible:outline-sky-500"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-500/15 text-sky-400 border border-sky-500/30 font-display text-sm font-bold">
              O
            </div>
            <span className="font-display text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
              OMNIX
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation menu"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {renderSection('nav_section_core', CORE_ITEMS)}
          {renderSection('nav_section_expansion', EXPANSION_ITEMS)}
          {renderSection('nav_section_platform', PLATFORM_ITEMS)}
        </nav>
      </aside>
    </>
  );
}
