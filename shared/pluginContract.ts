export type PluginPermissionScope =
  | 'workspace:read'
  | 'workspace:write'
  | 'projects:read'
  | 'projects:write'
  | 'files:read'
  | 'files:write'
  | 'network:outbound'
  | 'secrets:read'
  | 'audit:read';

export const ALL_PLUGIN_PERMISSIONS: PluginPermissionScope[] = [
  'workspace:read',
  'workspace:write',
  'projects:read',
  'projects:write',
  'files:read',
  'files:write',
  'network:outbound',
  'secrets:read',
  'audit:read',
];

export interface PluginInputField {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  description: string;
  defaultValue?: string | number | boolean;
}

export interface PluginActionSchema {
  id: string;
  name: string;
  description: string;
  requiredPermission: PluginPermissionScope;
  requiresApproval?: boolean;
  inputSchema: Record<string, PluginInputField>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  category: 'project_management' | 'cloud_storage' | 'reporting' | 'telemetry' | 'custom';
  description: string;
  permissions: PluginPermissionScope[];
  allowedDomains?: string[];
  entryType: 'builtin' | 'manifest_webhook';
  actions: PluginActionSchema[];
}

export interface PluginExecutionContext {
  workspaceId: string;
  projectId?: string | null;
  userId: string;
  userRole: 'admin' | 'engineer' | 'analyst' | 'viewer';
  grantedPermissions: PluginPermissionScope[];
  readStore: <T = unknown>(key: string) => T | null;
  writeStore: (key: string, value: unknown) => void;
  listProjects: () => Array<{ id: string; name: string; status: string; category: string }>;
  getFileById: (fileId: string) => { id: string; name: string; mime_type: string; size_bytes: number; content_text: string } | null;
  listFiles: () => Array<{ id: string; name: string; mime_type: string; size_bytes: number }>;
}

export interface PluginExecutionResult {
  ok: boolean;
  actionId: string;
  provider: string;
  summary: string;
  data: Record<string, unknown>;
  executedAt: string;
}

export interface OmnixPlugin {
  manifest: PluginManifest;
  initialize?: (ctx: Pick<PluginExecutionContext, 'workspaceId' | 'readStore' | 'writeStore'>) => void;
  execute: (
    actionId: string,
    input: Record<string, unknown>,
    ctx: PluginExecutionContext
  ) => Promise<PluginExecutionResult> | PluginExecutionResult;
}

const BLOCKED_SSRF_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
]);

export function validatePluginManifest(
  raw: unknown
): { valid: true; manifest: PluginManifest } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Manifest must be a JSON object.'] };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,60}$/.test(obj.id)) {
    errors.push('Manifest "id" must be 3-61 lowercase alphanumeric characters or hyphens.');
  }
  if (typeof obj.name !== 'string' || obj.name.trim().length < 2) {
    errors.push('Manifest "name" must be at least 2 characters.');
  }
  if (typeof obj.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(obj.version)) {
    errors.push('Manifest "version" must follow semantic versioning (e.g. 1.0.0).');
  }
  if (typeof obj.author !== 'string' || obj.author.trim().length < 2) {
    errors.push('Manifest "author" is required.');
  }
  if (typeof obj.description !== 'string' || obj.description.trim().length < 5) {
    errors.push('Manifest "description" must be at least 5 characters.');
  }

  const validCats = new Set(['project_management', 'cloud_storage', 'reporting', 'telemetry', 'custom']);
  if (typeof obj.category !== 'string' || !validCats.has(obj.category)) {
    errors.push('Manifest "category" must be project_management, cloud_storage, reporting, telemetry, or custom.');
  }

  if (!Array.isArray(obj.permissions) || obj.permissions.length === 0) {
    errors.push('Manifest "permissions" must declare at least one explicit permission scope.');
  } else {
    for (const p of obj.permissions) {
      if (typeof p !== 'string' || !ALL_PLUGIN_PERMISSIONS.includes(p as PluginPermissionScope)) {
        errors.push(`Invalid permission scope "${String(p)}".`);
      }
    }
  }

  if (obj.allowedDomains !== undefined) {
    if (!Array.isArray(obj.allowedDomains)) {
      errors.push('Manifest "allowedDomains" must be an array of hostnames.');
    } else {
      for (const dom of obj.allowedDomains) {
        if (typeof dom !== 'string' || !dom.trim()) {
          errors.push('Each allowedDomain must be a non-empty hostname.');
          continue;
        }
        const normalized = dom.trim().toLowerCase();
        if (
          BLOCKED_SSRF_HOSTS.has(normalized) ||
          normalized.startsWith('10.') ||
          normalized.startsWith('192.168.') ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(normalized)
        ) {
          errors.push(`Disallowed private or metadata domain "${dom}" in allowedDomains.`);
        }
      }
    }
  }

  if (!Array.isArray(obj.actions) || obj.actions.length === 0) {
    errors.push('Manifest "actions" must define at least one executable action.');
  } else {
    for (const act of obj.actions) {
      if (!act || typeof act !== 'object') {
        errors.push('Each action must be an object.');
        continue;
      }
      const a = act as Record<string, unknown>;
      if (typeof a.id !== 'string' || !/^[a-z0-9_]{2,40}$/.test(a.id)) {
        errors.push(`Action id "${String(a.id)}" must be lowercase snake_case.`);
      }
      if (typeof a.name !== 'string' || !a.name.trim()) {
        errors.push(`Action "${String(a.id)}" requires a display name.`);
      }
      if (
        typeof a.requiredPermission !== 'string' ||
        !ALL_PLUGIN_PERMISSIONS.includes(a.requiredPermission as PluginPermissionScope)
      ) {
        errors.push(`Action "${String(a.id)}" has invalid requiredPermission.`);
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    manifest: {
      id: String(obj.id),
      name: String(obj.name).trim(),
      version: String(obj.version),
      author: String(obj.author).trim(),
      category: obj.category as PluginManifest['category'],
      description: String(obj.description).trim(),
      permissions: obj.permissions as PluginPermissionScope[],
      allowedDomains: Array.isArray(obj.allowedDomains) ? obj.allowedDomains.map(String) : [],
      entryType: obj.entryType === 'manifest_webhook' ? 'manifest_webhook' : 'builtin',
      actions: obj.actions as PluginActionSchema[],
    },
  };
}

export function authorizePluginExecution(params: {
  enabled: boolean;
  userRole: 'admin' | 'engineer' | 'analyst' | 'viewer';
  manifestPermissions: PluginPermissionScope[];
  grantedPermissions: PluginPermissionScope[];
  requiredPermission: PluginPermissionScope;
}): { allowed: true } | { allowed: false; reason: string; code: 403 } {
  if (!params.enabled) {
    return { allowed: false, code: 403, reason: 'Plugin is currently disabled in OMNI CONNECT.' };
  }

  const isWritePerm =
    params.requiredPermission.endsWith(':write') || params.requiredPermission === 'network:outbound';

  if (params.userRole === 'viewer' && isWritePerm) {
    return {
      allowed: false,
      code: 403,
      reason: `RBAC role "viewer" cannot execute write or outbound plugin permission "${params.requiredPermission}".`,
    };
  }

  if (params.userRole === 'analyst' && params.requiredPermission === 'projects:write') {
    return {
      allowed: false,
      code: 403,
      reason: `RBAC role "analyst" lacks project mutation permission "${params.requiredPermission}".`,
    };
  }

  if (!params.manifestPermissions.includes(params.requiredPermission)) {
    return {
      allowed: false,
      code: 403,
      reason: `Security violation: plugin manifest did not declare "${params.requiredPermission}".`,
    };
  }

  if (!params.grantedPermissions.includes(params.requiredPermission)) {
    return {
      allowed: false,
      code: 403,
      reason: `Permission "${params.requiredPermission}" has not been granted to this plugin by workspace administrator.`,
    };
  }

  return { allowed: true };
}
