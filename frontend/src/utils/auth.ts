export const getToken = (): string | null => {
  return localStorage.getItem('token');
};

export const getCurrentUsername = (): string | null => {
  const token = getToken();
  if (!token) return null;

  try {
    const encodedPayload = token.split('.')[1];
    if (!encodedPayload) return null;
    const base64Payload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = base64Payload.padEnd(Math.ceil(base64Payload.length / 4) * 4, '=');
    const payload = JSON.parse(atob(paddedPayload));
    return typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub : null;
  } catch {
    return null;
  }
};

export const setToken = (token: string): void => {
  localStorage.setItem('token', token);
};

export const removeToken = (): void => {
  localStorage.removeItem('token');
};

export const getBackendSessionId = (): string | null => {
  return localStorage.getItem('backend_session_id');
};

export const setBackendSessionId = (sessionId: string): void => {
  localStorage.setItem('backend_session_id', sessionId);
};

export const removeBackendSessionId = (): void => {
  localStorage.removeItem('backend_session_id');
};

export const isTokenExpired = (token: string): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const now = Math.floor(Date.now() / 1000);
    return Boolean(payload.exp && now >= payload.exp);
  } catch {
    return true;
  }
};

export const clearAuth = (): void => {
  removeToken();
  removeBackendSessionId();
};
