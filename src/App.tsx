import React from 'react';
import { OmnixProvider, useOmnix } from './contexts/OmnixContext';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { DashboardView } from './components/views/DashboardView';
import { OnboardingView } from './components/views/OnboardingView';
import { AssistantView } from './components/views/AssistantView';
import { ProjectsView } from './components/views/ProjectsView';
import { AgentsView } from './components/views/AgentsView';
import { VisionView } from './components/views/VisionView';
import { VoiceView } from './components/views/VoiceView';
import { MemoryView } from './components/views/MemoryView';
import { ThreeDStudioView } from './components/views/ThreeDStudioView';
import { SimulationView } from './components/views/SimulationView';
import { WorldBuilderView } from './components/views/WorldBuilderView';
import { DataStudioView } from './components/views/DataStudioView';
import { CodexView } from './components/views/CodexView';
import { GenomeView } from './components/views/GenomeView';
import { LabView } from './components/views/LabView';
import { RadarView } from './components/views/RadarView';
import { TranslatorView } from './components/views/TranslatorView';
import { AutoBuildView } from './components/views/AutoBuildView';
import { AccountAuthView } from './components/views/AccountAuthView';
import { BillingPremiumView } from './components/views/BillingPremiumView';
import { IntegrationsView } from './components/views/IntegrationsView';
import { SecurityView } from './components/views/SecurityView';
import { SettingsView } from './components/views/SettingsView';
import { SystemHealthView } from './components/views/SystemHealthView';

function OmnixShell() {
  const { activeView } = useOmnix();

  const renderActiveView = () => {
    switch (activeView) {
      case 'home':
        return <DashboardView />;
      case 'onboarding':
        return <OnboardingView />;
      case 'assistant':
        return <AssistantView />;
      case 'projects':
        return <ProjectsView />;
      case 'agents':
        return <AgentsView />;
      case 'vision':
        return <VisionView />;
      case 'voice':
        return <VoiceView />;
      case 'memory':
        return <MemoryView />;
      case 'studio3d':
        return <ThreeDStudioView />;
      case 'simulation':
        return <SimulationView />;
      case 'world':
        return <WorldBuilderView />;
      case 'data':
        return <DataStudioView />;
      case 'codex':
        return <CodexView />;
      case 'genome':
        return <GenomeView />;
      case 'lab':
        return <LabView />;
      case 'radar':
        return <RadarView />;
      case 'translator':
        return <TranslatorView />;
      case 'autobuild':
        return <AutoBuildView />;
      case 'account':
        return <AccountAuthView />;
      case 'billing':
        return <BillingPremiumView />;
      case 'integrations':
        return <IntegrationsView />;
      case 'security':
        return <SecurityView />;
      case 'settings':
        return <SettingsView />;
      case 'health':
        return <SystemHealthView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0B0F17] text-slate-100">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{renderActiveView()}</main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <OmnixProvider>
      <OmnixShell />
    </OmnixProvider>
  );
}
