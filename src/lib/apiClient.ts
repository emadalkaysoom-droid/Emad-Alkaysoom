export function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('omnix_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const auth = getAuthHeaders();
  if (auth.Authorization && !headers.has('Authorization')) {
    headers.set('Authorization', auth.Authorization);
  }
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers });
}
