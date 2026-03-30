import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppLock } from "@/contexts/AppLockContext";

const C = {
  bg: "#0a0a0f",
  card: "#111118",
  border: "#1f1f2e",
  primary: "#10b981",
  muted: "#6b7280",
  text: "#ffffff",
  error: "#ef4444",
};

export function AppLockScreen() {
  const { isLocked, settings, hasPin, hasBiometricRegistered, verifyPin, tryBiometric } = useAppLock();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [bioLoading, setBioLoading] = useState(false);
  const [showPinFallback, setShowPinFallback] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const pinLen = settings.pinLength;
  const isBioMode = (settings.lockType === "fingerprint" || settings.lockType === "face") && hasBiometricRegistered;

  useEffect(() => {
    if (!isLocked) { setPin(""); setError(""); setShowPinFallback(false); return; }
    if (!isBioMode) setShowPinFallback(true);
  }, [isLocked, isBioMode]);

  const doShake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const submitPin = useCallback(async (p: string) => {
    const ok = await verifyPin(p);
    if (!ok) {
      setError("Incorrect PIN. Try again.");
      doShake();
      setPin("");
    } else {
      setError("");
    }
  }, [verifyPin, doShake]);

  useEffect(() => {
    if (pin.length === pinLen) submitPin(pin);
  }, [pin, pinLen, submitPin]);

  const handleBio = useCallback(async () => {
    setError("");
    setBioLoading(true);
    const ok = await tryBiometric();
    setBioLoading(false);
    if (!ok) setError("Biometric not recognized. Use PIN.");
  }, [tryBiometric]);

  useEffect(() => {
    if (isLocked && isBioMode && !showPinFallback) handleBio();
  }, [isLocked, isBioMode, showPinFallback, handleBio]);

  const pressKey = (k: string) => {
    if (pin.length >= pinLen) return;
    setError("");
    setPin(p => p + k);
  };

  const deleteLast = () => setPin(p => p.slice(0, -1));

  if (!isLocked) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.container}>
        {/* Icon */}
        <View style={styles.iconBox}>
          <Ionicons name="lock-closed" size={44} color={C.primary} />
        </View>
        <Text style={styles.title}>Private</Text>
        <Text style={styles.subtitle}>
          {isBioMode && !showPinFallback
            ? settings.lockType === "face" ? "Look at your camera to unlock" : "Touch the fingerprint sensor to unlock"
            : "Enter your PIN to unlock"}
        </Text>

        {isBioMode && !showPinFallback ? (
          <>
            <TouchableOpacity
              style={[styles.bioBtn, bioLoading && styles.bioBtnLoading]}
              onPress={handleBio}
              disabled={bioLoading}
              activeOpacity={0.8}
            >
              <Ionicons
                name={settings.lockType === "face" ? "happy-outline" : "finger-print"}
                size={52}
                color={bioLoading ? `${C.primary}80` : C.primary}
              />
              <Text style={[styles.bioLabel, bioLoading && { opacity: 0.5 }]}>
                {bioLoading ? "Verifying..." : "Tap to unlock"}
              </Text>
            </TouchableOpacity>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {hasPin && (
              <TouchableOpacity onPress={() => { setShowPinFallback(true); setError(""); }} style={styles.switchBtn}>
                <Text style={styles.switchText}>Use PIN instead</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <>
            {/* PIN dots */}
            <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
              {Array.from({ length: pinLen }).map((_, i) => (
                <View
                  key={i}
                  style={[styles.dot, i < pin.length && styles.dotFilled]}
                />
              ))}
            </Animated.View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {/* Numpad */}
            <View style={styles.numpad}>
              {[1,2,3,4,5,6,7,8,9].map(n => (
                <TouchableOpacity key={n} style={styles.numBtn} onPress={() => pressKey(String(n))} activeOpacity={0.7}>
                  <Text style={styles.numText}>{n}</Text>
                </TouchableOpacity>
              ))}
              {isBioMode ? (
                <TouchableOpacity style={styles.numBtn} onPress={() => { setShowPinFallback(false); setPin(""); setError(""); handleBio(); }} activeOpacity={0.7}>
                  <Ionicons name={settings.lockType === "face" ? "happy-outline" : "finger-print"} size={26} color={C.primary} />
                </TouchableOpacity>
              ) : <View style={styles.numBtn} />}
              <TouchableOpacity style={styles.numBtn} onPress={() => pressKey("0")} activeOpacity={0.7}>
                <Text style={styles.numText}>0</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.numBtn} onPress={deleteLast} activeOpacity={0.7} disabled={!pin.length}>
                <Ionicons name="backspace-outline" size={26} color={pin.length ? C.text : C.muted} />
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: C.bg, zIndex: 9999, justifyContent: "center", alignItems: "center",
  },
  container: { alignItems: "center", paddingHorizontal: 40, width: "100%" },
  iconBox: {
    width: 96, height: 96, borderRadius: 28,
    backgroundColor: "#10b98120", borderWidth: 1, borderColor: "#10b98130",
    alignItems: "center", justifyContent: "center", marginBottom: 20,
  },
  title: { fontSize: 26, color: C.text, fontFamily: "Inter_700Bold", marginBottom: 6 },
  subtitle: { fontSize: 14, color: C.muted, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 40 },
  bioBtn: {
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 3, borderColor: C.primary,
    backgroundColor: "#10b98112",
    alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 16,
  },
  bioBtnLoading: { borderColor: `${C.primary}50`, opacity: 0.7 },
  bioLabel: { fontSize: 11, color: C.primary, fontFamily: "Inter_500Medium" },
  dotsRow: { flexDirection: "row", gap: 16, marginBottom: 12 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: `${C.muted}60` },
  dotFilled: { backgroundColor: C.primary, borderColor: C.primary },
  errorText: { fontSize: 13, color: C.error, fontFamily: "Inter_400Regular", marginBottom: 8, textAlign: "center" },
  numpad: { flexDirection: "row", flexWrap: "wrap", width: 264, gap: 12, marginTop: 16 },
  numBtn: {
    width: 80, height: 72, borderRadius: 18,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
  },
  numText: { fontSize: 26, color: C.text, fontFamily: "Inter_400Regular" },
  switchBtn: { marginTop: 24 },
  switchText: { fontSize: 13, color: C.muted, fontFamily: "Inter_400Regular", textDecorationLine: "underline" },
});
