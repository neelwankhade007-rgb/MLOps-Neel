/**
 * Safe JWT parsing with RFC 7515 base64url compliance and UTF-8 handling.
 * Eliminates DOMException crashes caused by unpadded or url-safe base64 strings.
 */
export const parseJwtPayload = (token: string): Record<string, any> | null => {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const base64Url = parts[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const jsonString = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const parsed = JSON.parse(jsonString);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
};

export const getToken = (): string | null => {
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
};

export const setToken = (token: string): void => {
  try {
    localStorage.setItem('token', token);
  } catch {
    // Graceful fallback if storage quota exceeded or disabled
  }
};

export const removeToken = (): void => {
  try {
    localStorage.removeItem('token');
  } catch {
    // Ignore storage failure
  }
};

export const getCurrentUsername = (): string | null => {
  const token = getToken();
  if (!token) return null;

  const payload = parseJwtPayload(token);
  if (!payload) return null;

  return typeof payload.sub === 'string' && payload.sub.trim()
    ? payload.sub.trim()
    : null;
};

export const getBackendSessionId = (): string | null => {
  try {
    return localStorage.getItem('backend_session_id');
  } catch {
    return null;
  }
};

export const setBackendSessionId = (sessionId: string): void => {
  try {
    localStorage.setItem('backend_session_id', sessionId);
  } catch {
    // Ignore storage failure
  }
};

export const removeBackendSessionId = (): void => {
  try {
    localStorage.removeItem('backend_session_id');
  } catch {
    // Ignore storage failure
  }
};

export const isTokenExpired = (token: string): boolean => {
  if (!token || typeof token !== 'string') return true;
  const payload = parseJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return true;

  const now = Math.floor(Date.now() / 1000);
  return now >= payload.exp;
};

export const clearAuth = (): void => {
  removeToken();
  removeBackendSessionId();
};
