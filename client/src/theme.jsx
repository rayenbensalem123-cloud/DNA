import { createContext, useContext, useEffect } from 'react';

// The platform is light-mode only. The context stays so existing imports keep working.
const ThemeContext = createContext({ theme: 'light', toggleTheme: () => {} });

export function ThemeProvider({ children }) {
  useEffect(() => {
    document.documentElement.dataset.theme = 'light';
    try { localStorage.removeItem('bo_theme'); } catch { /* storage may be unavailable */ }
  }, []);
  return <ThemeContext.Provider value={{ theme: 'light', toggleTheme: () => {} }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
