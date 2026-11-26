import React, { createContext, useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  getToken,
  setToken,
  getBackendSessionId,
  setBackendSessionId,
  clearAuth,
  isTokenExpired,
} from '../utils/auth';
import { authApi } from '../api/authApi';
import { setUnauthorizedHandler } from '../api/client';

export interface AuthContextType {
  auth: boolean;
  loadingApp: boolean;
  setAuth: (val: boolean) => void;
  login: (token: string, backendSessionId?: string) => void;
  logout: (showMessage?: boolean) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [auth, setAuth] = useState(false);
  const [loadingApp, setLoadingApp] = useState(true);

  const logout = useCallback((showMessage = true) => {
    clearAuth();
    if (showMessage) {
      toast.error('Session expired or logged out. Please sign in.');
    }
    setAuth(false);
  }, []);

  const login = useCallback((token: string, backendSessionId?: string) => {
    setToken(token);
    if (backendSessionId) {
      setBackendSessionId(backendSessionId);
    }
    setAuth(true);
  }, []);

  useEffect(() => {
    // Register global 401 unauthorized handler
    setUnauthorizedHandler(() => {
      logout(true);
    });

    const checkAuth = async () => {
      const token = getToken();
      if (!token) {
        setLoadingApp(false);
        return;
      }

      if (isTokenExpired(token)) {
        logout(true);
        setLoadingApp(false);
        return;
      }

      const storedSessionId = getBackendSessionId();
      if (storedSessionId) {
        try {
          const res = await authApi.getSession();
          if (res?.session_id && res.session_id !== storedSessionId) {
            logout(true);
            setLoadingApp(false);
            return;
          }
        } catch {
          // Gracefully maintain offline resilience on network glitches
        }
      }

      setAuth(true);
      setLoadingApp(false);
    };

    checkAuth();
  }, [logout]);

  return (
    <AuthContext.Provider
      value={{
        auth,
        loadingApp,
        setAuth,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
