import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

interface AuthUser {
  email: string;
  createdAt: string;
}

interface StoredUser extends AuthUser {
  password: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string, newPassword: string) => Promise<void>;
  logout: () => void;
}

const USERS_KEY = 'snapline.auth.users';
const CURRENT_USER_KEY = 'snapline.auth.currentUser';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readUsers(): StoredUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    return raw ? (JSON.parse(raw) as StoredUser[]) : [];
  } catch (error) {
    console.error('Failed to read saved users', error);
    return [];
  }
}

function saveUsers(users: StoredUser[]) {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch (error) {
    console.error('Failed to persist users', error);
  }
}

function readCurrentUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch (error) {
    console.error('Failed to read current user', error);
    return null;
  }
}

function saveCurrentUser(user: AuthUser | null) {
  try {
    if (user) {
      localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(CURRENT_USER_KEY);
    }
  } catch (error) {
    console.error('Failed to persist current user', error);
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<StoredUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setUsers(readUsers());
    setUser(readCurrentUser());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!isLoading) {
      saveUsers(users);
    }
  }, [users, isLoading]);

  useEffect(() => {
    if (!isLoading) {
      saveCurrentUser(user);
    }
  }, [user, isLoading]);

  const signUp = async (email: string, password: string) => {
    const existing = users.find((entry) => entry.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      throw new Error('An account with this email already exists.');
    }

    const timestamp = new Date().toISOString();
    const newUser: StoredUser = {
      email,
      password,
      createdAt: timestamp,
    };

    setUsers((prev) => [...prev, newUser]);
    setUser({ email, createdAt: timestamp });
  };

  const login = async (email: string, password: string) => {
    const matchingUser = users.find((entry) => entry.email.toLowerCase() === email.toLowerCase());
    if (!matchingUser || matchingUser.password !== password) {
      throw new Error('Invalid email or password.');
    }

    setUser({ email: matchingUser.email, createdAt: matchingUser.createdAt });
  };

  const resetPassword = async (email: string, newPassword: string) => {
    let updatedUser: StoredUser | undefined;
    setUsers((prev) => {
      const next = prev.map((entry) => {
        if (entry.email.toLowerCase() === email.toLowerCase()) {
          updatedUser = { ...entry, password: newPassword };
          return updatedUser;
        }
        return entry;
      });
      return next;
    });

    if (!updatedUser) {
      throw new Error('We could not find an account with that email.');
    }

    // Keep the user signed in if they reset while authenticated
    setUser((current) => (current?.email.toLowerCase() === email.toLowerCase() ? { ...current } : current));
  };

  const logout = () => setUser(null);

  const value = useMemo(
    () => ({ user, isLoading, signUp, login, resetPassword, logout }),
    [user, isLoading, users]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
