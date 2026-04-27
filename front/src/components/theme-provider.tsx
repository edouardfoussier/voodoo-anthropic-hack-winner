import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";
interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}
const ThemeContext = createContext<ThemeCtx>({ theme: "light", toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    // Always clear any previously stored dark preference so the app stays light
    try { localStorage.removeItem("theme"); } catch {}
    document.documentElement.classList.remove("dark");
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <ThemeContext.Provider
      value={{ theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
