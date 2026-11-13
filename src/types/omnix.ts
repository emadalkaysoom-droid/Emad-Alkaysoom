export type OmnixView =
  | 'home'
  | 'onboarding'
  | 'assistant'
  | 'projects'
  | 'agents'
  | 'vision'
  | 'voice'
  | 'memory'
  | 'studio3d'
  | 'simulation'
  | 'world'
  | 'data'
  | 'codex'
  | 'genome'
  | 'lab'
  | 'radar'
  | 'translator'
  | 'autobuild'
  | 'account'
  | 'billing'
  | 'integrations'
  | 'security'
  | 'settings'
  | 'health';

export interface Workspace {
  id: string;
  organization_id: string;
  owner_id: string;
  name: string;
  description: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  status: 'active' | 'archived' | 'paused';
  category: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type AccountRole =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'PREMIUM_USER'
  | 'FREE_USER'
  | 'DEVELOPER'
  | 'SYSTEM_AGENT';

export interface AuthUser {
  id: string;
  email: string;
  username?: string | null;
  full_name?: string;
  name: string;
  role: 'admin' | 'engineer' | 'analyst' | 'viewer';
  account_role?: AccountRole;
  preferred_language: 'en' | 'ar';
  country?: string;
  avatar_url?: string;
  email_verified?: number;
  two_factor_enabled?: number;
}

export interface SubscriptionSummary {
  planCode: 'FREE' | 'PREMIUM';
  planName: string;
  priceUsd: number;
  billingIntervalDays: number;
  status: 'FREE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED' | 'PAYMENT_PENDING' | 'SUSPENDED';
  isPremiumActive: boolean;
  startDate: string | null;
  expirationDate: string | null;
  renewalDate: string | null;
  cancellationDate: string | null;
  autoRenew: boolean;
  provider: string;
  stripeConfigured: boolean;
  activeEntitlements: string[];
  allEntitlements: Array<{
    id: string;
    feature_key: string;
    title: string;
    title_ar: string;
    description: string;
    description_ar: string;
    category: string;
    unlocked: boolean;
  }>;
  quotas: { projects: number; codexRunsPerDay: number; labExperiments: number; autobuildApps: number };
}

export interface AgentInfo {
  id: string;
  name: string;
  role_title: string;
  specialty: string;
  allowed_tools_json: string;
  permission_level: 'restricted' | 'standard' | 'elevated';
  status: 'idle' | 'busy' | 'disabled';
  success_rate: number;
  tasks_completed: number;
}

export interface AgentTask {
  id: string;
  workspace_id: string;
  project_id: string | null;
  agent_id: string;
  agent_name?: string;
  title: string;
  description: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'awaiting_approval' | 'cancelled';
  priority: number;
  requires_approval: number;
  scheduled_for: string | null;
  retry_count: number;
  created_at: string;
}

export interface SubsystemHealth {
  id: string;
  name: string;
  layer: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'NOT CONFIGURED' | 'ERROR';
  latencyMs: number;
  detail: string;
  checkedAt: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'success';
  is_read: number;
  created_at: string;
}
