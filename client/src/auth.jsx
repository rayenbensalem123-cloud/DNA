import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, clearToken } from './api';

const AuthContext = createContext({
  user: null,
  loading: true,
  login: async (username, password) => {},
  logout: async () => {},
  setUser: () => {},
  welcome: null,
  endWelcome: () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [welcome, setWelcome] = useState(null); // set right after a sign-in so the app can greet the user

  useEffect(() => {
    let cancelled = false;
    if (!getToken()) { setLoading(false); return; }
    api.me()
      .then((d) => { if (!cancelled) { setUser(d.user); } })
      .catch(() => { if (!cancelled) { clearToken(); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const login = async (username, password) => {
    const d = await api.login(username, password);
    setToken(d.token);
    setUser(d.user);
    setWelcome({ name: d.user.name, role: d.user.role });
    return d.user;
  };

  const logout = async () => {
    try { await api.logout(); } catch (e) { /* ignore */ }
    clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser, welcome, endWelcome: () => setWelcome(null) }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

