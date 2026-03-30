import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { AuthError, getCurrentUser, login as apiLogin, register as apiRegister, logout as apiLogout, clearToken, getToken, saveUserCache, loadUserCache } from "@/lib/api";

interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, username: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        setUser(null);
        return;
      }
      try {
        const data = await getCurrentUser();
        if (data.isAuthenticated && data.user) {
          setUser(data.user);
          await saveUserCache(data.user);
        } else {
          setUser(null);
          await clearToken();
        }
      } catch (err) {
        if (err instanceof AuthError) {
          setUser(null);
          await clearToken();
        } else {
          const cached = await loadUserCache();
          if (cached) {
            setUser(cached);
          } else {
            setUser(null);
          }
        }
      }
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setIsLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiLogin(email, password);
    const userData: AuthUser = {
      id: data.user.id,
      email: data.user.email,
      firstName: data.user.firstName,
      lastName: null,
      profileImageUrl: null,
    };
    setUser(userData);
    await saveUserCache(userData);
  }, []);

  const register = useCallback(async (email: string, password: string, username: string) => {
    const data = await apiRegister(email, password, username);
    const userData: AuthUser = {
      id: data.user.id,
      email: data.user.email,
      firstName: data.user.firstName,
      lastName: null,
      profileImageUrl: null,
    };
    setUser(userData);
    await saveUserCache(userData);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
