import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, AppStateStatus } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";

const PIN_KEY = "app_lock_pin";
const SETTINGS_KEY = "app_lock_settings";

export type LockType = "none" | "pin" | "fingerprint" | "face";
export type AutoLockTimer = 0 | 30 | 60 | 300 | 600;

export interface AppLockSettings {
  enabled: boolean;
  lockType: LockType;
  autoLockTimer: AutoLockTimer;
  pinLength: 4 | 6;
  biometricAvailable: boolean;
}

const DEFAULT_SETTINGS: AppLockSettings = {
  enabled: false,
  lockType: "none",
  autoLockTimer: 0,
  pinLength: 4,
  biometricAvailable: false,
};

interface AppLockContextValue {
  settings: AppLockSettings;
  isLocked: boolean;
  hasPin: boolean;
  hasBiometricRegistered: boolean;
  setEnabled: (v: boolean) => void;
  setLockType: (v: LockType) => void;
  setPinLength: (v: 4 | 6) => void;
  setAutoLockTimer: (v: AutoLockTimer) => void;
  setPin: (pin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  registerBiometric: () => Promise<boolean>;
  tryBiometric: () => Promise<boolean>;
  lock: () => void;
  unlock: () => void;
}

const AppLockContext = createContext<AppLockContextValue | null>(null);

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppLockSettings>(DEFAULT_SETTINGS);
  const [hasPin, setHasPin] = useState(false);
  const [hasBiometricRegistered, setHasBiometricRegistered] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const backgroundTime = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(SETTINGS_KEY);
      if (raw) {
        try { setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) }); } catch {}
      }
      const pin = await AsyncStorage.getItem(PIN_KEY);
      setHasPin(!!pin);

      const hasBio = await AsyncStorage.getItem("bio_registered");
      setHasBiometricRegistered(hasBio === "1");

      const bioAvailable = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setSettings(s => ({ ...s, biometricAvailable: bioAvailable && enrolled }));
    })();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "background" || state === "inactive") {
        backgroundTime.current = Date.now();
      } else if (state === "active") {
        // Lock if app lock is enabled AND user has either PIN or biometric registered
        if (!settings.enabled || (!hasPin && !hasBiometricRegistered)) return;
        const timer = settings.autoLockTimer;
        if (timer === 0) {
          setIsLocked(true);
        } else if (backgroundTime.current) {
          const elapsed = (Date.now() - backgroundTime.current) / 1000;
          if (elapsed >= timer) setIsLocked(true);
        }
        backgroundTime.current = null;
      }
    });
    return () => sub.remove();
  }, [settings.enabled, settings.autoLockTimer, hasPin, hasBiometricRegistered]);

  const saveSettings = async (s: AppLockSettings) => {
    setSettings(s);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  };

  const setEnabled = useCallback((v: boolean) => {
    saveSettings({ ...settings, enabled: v });
    if (!v) setIsLocked(false);
    else if (hasPin || hasBiometricRegistered) setIsLocked(true);
  }, [settings, hasPin, hasBiometricRegistered]);

  const setLockType = useCallback((v: LockType) => {
    saveSettings({ ...settings, lockType: v });
  }, [settings]);

  const setPinLength = useCallback((v: 4 | 6) => {
    saveSettings({ ...settings, pinLength: v });
  }, [settings]);

  const setAutoLockTimer = useCallback((v: AutoLockTimer) => {
    saveSettings({ ...settings, autoLockTimer: v });
  }, [settings]);

  const setPin = useCallback(async (pin: string) => {
    await AsyncStorage.setItem(PIN_KEY, pin);
    setHasPin(true);
  }, []);

  const verifyPin = useCallback(async (pin: string): Promise<boolean> => {
    const stored = await AsyncStorage.getItem(PIN_KEY);
    if (stored === pin) {
      setIsLocked(false);
      return true;
    }
    return false;
  }, []);

  const registerBiometric = useCallback(async (): Promise<boolean> => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Register biometric for app lock",
      cancelLabel: "Cancel",
      disableDeviceFallback: true,   // We handle PIN fallback ourselves
      biometricsSecurityLevel: "weak", // Allow face unlock on Android (often classified as "weak")
    });
    if (result.success) {
      await AsyncStorage.setItem("bio_registered", "1");
      setHasBiometricRegistered(true);
      return true;
    }
    return false;
  }, []);

  const tryBiometric = useCallback(async (): Promise<boolean> => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Private",
      cancelLabel: "Use PIN",
      disableDeviceFallback: true,   // We handle PIN fallback ourselves
      biometricsSecurityLevel: "weak", // Allow face unlock on Android (often classified as "weak")
    });
    if (result.success) {
      setIsLocked(false);
      return true;
    }
    return false;
  }, []);

  const lock = useCallback(() => {
    if (settings.enabled && (hasPin || hasBiometricRegistered)) setIsLocked(true);
  }, [settings.enabled, hasPin, hasBiometricRegistered]);

  const unlock = useCallback(() => setIsLocked(false), []);

  return (
    <AppLockContext.Provider value={{
      settings, isLocked, hasPin, hasBiometricRegistered,
      setEnabled, setLockType, setPinLength, setAutoLockTimer,
      setPin, verifyPin, registerBiometric, tryBiometric,
      lock, unlock,
    }}>
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error("useAppLock must be used inside AppLockProvider");
  return ctx;
}
