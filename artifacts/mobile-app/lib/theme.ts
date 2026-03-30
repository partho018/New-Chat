import { useTheme } from "@/contexts/ThemeContext";

export const DARK_COLORS = {
  bg: "#0a0a0f",
  card: "#111118",
  border: "#1f1f2e",
  primary: "#10b981",
  muted: "#6b7280",
  text: "#ffffff",
  subtext: "#9ca3af",
  danger: "#ef4444",
  other: "#1a1a28",
  inputBg: "#111118",
  inputText: "#ffffff",
  tabBar: "#0a0a0f",
  headerBg: "#0a0a0f",
  bubble: "#1a1a28",
  bubbleSelf: "#0d3d2c",
  notifBg: "#1a1a28",
};

export const LIGHT_COLORS = {
  bg: "#f0f2f5",
  card: "#ffffff",
  border: "#e2e8f0",
  primary: "#059669",
  muted: "#64748b",
  text: "#0f172a",
  subtext: "#475569",
  danger: "#dc2626",
  other: "#e4e6eb",
  inputBg: "#ffffff",
  inputText: "#0f172a",
  tabBar: "#ffffff",
  headerBg: "#ffffff",
  bubble: "#e4e6eb",
  bubbleSelf: "#d1fae5",
  notifBg: "#f1f5f9",
};

export type AppColors = typeof DARK_COLORS;

export function useThemeColors(): AppColors {
  const { isDark } = useTheme();
  return isDark ? DARK_COLORS : LIGHT_COLORS;
}
