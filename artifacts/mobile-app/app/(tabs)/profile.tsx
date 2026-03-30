import React, { useState, useEffect, useMemo } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  ScrollView, TextInput, ActivityIndicator, Image, Switch, Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/contexts/AuthContext";
import { updateProfile, uploadAvatar, getUserById, APP_BASE } from "@/lib/api";
import { useAppLock, AutoLockTimer, LockType } from "@/contexts/AppLockContext";
import { useTheme, ThemeMode } from "@/contexts/ThemeContext";
import { useThemeColors } from "@/lib/theme";

/* ─── App Lock Settings Modal ─── */
function AppLockModal({ onClose }: { onClose: () => void }) {
  const C = useThemeColors();
  const {
    settings, hasPin, hasBiometricRegistered,
    setEnabled, setLockType, setPinLength, setAutoLockTimer,
    setPin, verifyPin, registerBiometric,
  } = useAppLock();

  type PinStep = "idle" | "enter_new" | "confirm_new" | "verify_current";
  const [pinStep, setPinStep] = useState<PinStep>("idle");
  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinError, setPinError] = useState("");
  const [bioWorking, setBioWorking] = useState(false);

  const pinLen = settings.pinLength;

  const al = useMemo(() => StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 56, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border },
    backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    title: { flex: 1, fontSize: 18, color: C.text, fontFamily: "Inter_600SemiBold", textAlign: "center" },
    section: {},
    sectionTitle: { fontSize: 12, color: C.muted, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, paddingHorizontal: 4 },
    card: { backgroundColor: C.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 16 },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    iconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: `${C.primary}20`, alignItems: "center", justifyContent: "center" },
    rowTitle: { fontSize: 15, color: C.text, fontFamily: "Inter_500Medium" },
    rowDesc: { fontSize: 12, color: C.muted, fontFamily: "Inter_400Regular", marginTop: 2 },
    pill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: C.border, borderWidth: 1, borderColor: C.border },
    pillActive: { backgroundColor: `${C.primary}20`, borderColor: C.primary },
    pillText: { fontSize: 13, color: C.muted, fontFamily: "Inter_500Medium" },
    pillTextActive: { color: C.primary },
    actionBtn: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, backgroundColor: `${C.primary}15`, borderWidth: 1, borderColor: `${C.primary}30` },
    actionBtnText: { fontSize: 14, color: C.primary, fontFamily: "Inter_500Medium" },
    pinInput: { backgroundColor: C.inputBg, borderRadius: 10, padding: 14, fontSize: 20, color: C.text, borderWidth: 1, borderColor: C.border, textAlign: "center", letterSpacing: 8, fontFamily: "Inter_400Regular" },
    cancelBtn: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: C.border, alignItems: "center" },
    cancelBtnText: { color: C.muted, fontFamily: "Inter_500Medium" },
    confirmBtn: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: C.primary, alignItems: "center" },
    confirmBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  }), [C]);

  const LOCK_OPTIONS: { id: LockType; label: string; icon: string }[] = [
    { id: "pin", label: "PIN", icon: "keypad-outline" },
    { id: "fingerprint", label: "Fingerprint", icon: "finger-print" },
    { id: "face", label: "Face ID", icon: "happy-outline" },
  ];

  const AUTO_LOCK_OPTIONS: { value: AutoLockTimer; label: string }[] = [
    { value: 0, label: "Immediately" },
    { value: 30, label: "After 30 seconds" },
    { value: 60, label: "After 1 minute" },
    { value: 300, label: "After 5 minutes" },
    { value: 600, label: "After 10 minutes" },
  ];

  async function handleSetupPin() {
    if (!hasPin) { setPinStep("enter_new"); }
    else { setPinStep("verify_current"); }
    setPinInput(""); setPinConfirm(""); setPinError("");
  }

  async function handlePinSubmit() {
    if (pinStep === "enter_new") {
      if (pinInput.length < pinLen) return;
      setPinConfirm(""); setPinStep("confirm_new");
    } else if (pinStep === "confirm_new") {
      if (pinInput !== pinConfirm) {
        setPinError("PINs don't match. Try again.");
        setPinInput(""); setPinConfirm(""); setPinStep("enter_new"); return;
      }
      await setPin(pinInput); setPinStep("idle");
      Alert.alert("PIN Set", "Your app lock PIN has been set.");
    } else if (pinStep === "verify_current") {
      const ok = await verifyPin(pinInput);
      if (!ok) { setPinError("Incorrect PIN."); setPinInput(""); return; }
      setPinError(""); setPinInput(""); setPinStep("enter_new");
    }
  }

  async function handleRegisterBio(type: LockType) {
    if (!hasPin) { Alert.alert("Set PIN first", "Please set a PIN before enabling biometric lock."); return; }
    setBioWorking(true);
    const ok = await registerBiometric();
    setBioWorking(false);
    if (ok) { setLockType(type); Alert.alert("Success", "Biometric lock registered!"); }
    else Alert.alert("Failed", "Biometric registration failed.");
  }

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen">
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={al.header}>
          <TouchableOpacity onPress={onClose} style={al.backBtn}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={al.title}>App Lock</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={{ padding: 20, gap: 20 }}>
          <View style={al.card}>
            <View style={al.row}>
              <View style={al.iconBox}>
                <Ionicons name="lock-closed" size={20} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={al.rowTitle}>App Lock</Text>
                <Text style={al.rowDesc}>Require authentication to open the app</Text>
              </View>
              <Switch
                value={settings.enabled}
                onValueChange={v => {
                  if (v && !hasPin) { Alert.alert("Set PIN first", "Please set a PIN to enable app lock."); return; }
                  setEnabled(v);
                }}
                trackColor={{ false: C.border, true: `${C.primary}80` }}
                thumbColor={settings.enabled ? C.primary : C.muted}
              />
            </View>
          </View>

          <View style={al.section}>
            <Text style={al.sectionTitle}>PIN</Text>
            <View style={al.card}>
              <View style={[al.row, { marginBottom: 14 }]}>
                <Text style={al.rowTitle}>PIN Length</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {([4, 6] as const).map(n => (
                    <TouchableOpacity key={n} style={[al.pill, settings.pinLength === n && al.pillActive]} onPress={() => setPinLength(n)}>
                      <Text style={[al.pillText, settings.pinLength === n && al.pillTextActive]}>{n} digits</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {pinStep === "idle" ? (
                <TouchableOpacity style={al.actionBtn} onPress={handleSetupPin}>
                  <Ionicons name="keypad-outline" size={18} color={C.primary} />
                  <Text style={al.actionBtnText}>{hasPin ? "Change PIN" : "Set PIN"}</Text>
                </TouchableOpacity>
              ) : (
                <View style={{ gap: 10 }}>
                  <Text style={al.rowDesc}>
                    {pinStep === "verify_current" ? "Enter current PIN:" : pinStep === "confirm_new" ? "Confirm new PIN:" : "Enter new PIN:"}
                  </Text>
                  <TextInput
                    style={al.pinInput}
                    value={pinStep === "confirm_new" ? pinConfirm : pinInput}
                    onChangeText={v => {
                      const clean = v.replace(/\D/g, "").slice(0, pinLen);
                      if (pinStep === "confirm_new") setPinConfirm(clean);
                      else setPinInput(clean);
                    }}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={pinLen}
                    autoFocus
                    placeholder={"•".repeat(pinLen)}
                    placeholderTextColor={C.muted}
                  />
                  {pinError ? <Text style={{ color: C.danger, fontSize: 13 }}>{pinError}</Text> : null}
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity style={al.cancelBtn} onPress={() => { setPinStep("idle"); setPinInput(""); setPinConfirm(""); setPinError(""); }}>
                      <Text style={al.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={al.confirmBtn} onPress={handlePinSubmit}>
                      <Text style={al.confirmBtnText}>Continue</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </View>

          <View style={al.section}>
            <Text style={al.sectionTitle}>Lock Type</Text>
            <View style={al.card}>
              {LOCK_OPTIONS.map(opt => (
                <TouchableOpacity key={opt.id} style={[al.row, { marginBottom: 6 }]} onPress={() => { if (opt.id === "pin") setLockType("pin"); else handleRegisterBio(opt.id); }} disabled={bioWorking}>
                  <Ionicons name={opt.icon as any} size={20} color={settings.lockType === opt.id ? C.primary : C.muted} />
                  <Text style={[al.rowTitle, { flex: 1, marginLeft: 10 }]}>{opt.label}</Text>
                  {settings.lockType === opt.id && <Ionicons name="checkmark-circle" size={20} color={C.primary} />}
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={al.section}>
            <Text style={al.sectionTitle}>Auto-lock</Text>
            <View style={al.card}>
              {AUTO_LOCK_OPTIONS.map(opt => (
                <TouchableOpacity key={opt.value} style={[al.row, { marginBottom: 4 }]} onPress={() => setAutoLockTimer(opt.value)}>
                  <Text style={[al.rowTitle, { flex: 1 }]}>{opt.label}</Text>
                  {settings.autoLockTimer === opt.value && <Ionicons name="checkmark-circle" size={20} color={C.primary} />}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
}

/* ─── Main Profile Screen ─── */
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout, refreshUser } = useAuth();
  const { settings: lockSettings, hasPin } = useAppLock();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const C = useThemeColors();

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.firstName || "");
  const [saving, setSaving] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [showAppLock, setShowAppLock] = useState(false);

  const styles = useMemo(() => StyleSheet.create({
    container: { paddingHorizontal: 20 },
    headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: C.text, marginBottom: 24 },
    avatarSection: { alignItems: "center", marginBottom: 32 },
    avatarWrapper: { position: "relative", marginBottom: 12 },
    avatarPlaceholder: { width: 88, height: 88, borderRadius: 44, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
    avatarImage: { width: 88, height: 88, borderRadius: 44 },
    avatarText: { fontSize: 34, color: "#fff", fontFamily: "Inter_700Bold" },
    cameraOverlay: { position: "absolute", bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: C.muted, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: C.bg },
    userName: { fontSize: 20, color: C.text, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
    userHandle: { fontSize: 14, color: C.muted, fontFamily: "Inter_400Regular" },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 13, color: C.muted, fontFamily: "Inter_500Medium", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
    card: { backgroundColor: C.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 8 },
    fieldRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    fieldLabel: { fontSize: 12, color: C.muted, fontFamily: "Inter_500Medium", marginBottom: 4 },
    fieldValue: { fontSize: 15, color: C.text, fontFamily: "Inter_400Regular" },
    input: { backgroundColor: C.inputBg, borderRadius: 8, padding: 12, fontSize: 15, color: C.inputText, borderWidth: 1, borderColor: C.border, marginTop: 8, fontFamily: "Inter_400Regular" },
    editActions: { flexDirection: "row", gap: 8, marginTop: 12 },
    cancelBtn: { flex: 1, padding: 10, borderRadius: 8, backgroundColor: C.border, alignItems: "center" },
    cancelBtnText: { color: C.muted, fontFamily: "Inter_500Medium" },
    saveBtn: { flex: 1, padding: 10, borderRadius: 8, backgroundColor: C.primary, alignItems: "center" },
    saveBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold" },
    infoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    infoText: { fontSize: 14, color: C.primary, fontFamily: "Inter_400Regular" },
    logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: `${C.danger}20`, borderRadius: 12, paddingVertical: 16, borderWidth: 1, borderColor: `${C.danger}30` },
    logoutText: { fontSize: 16, color: C.danger, fontFamily: "Inter_600SemiBold" },
  }), [C]);

  useEffect(() => {
    if (!user?.id) return;
    getUserById(user.id)
      .then(data => {
        if (data.avatarUrl) {
          setAvatarUrl(data.avatarUrl.startsWith("http") ? data.avatarUrl : `${APP_BASE}${data.avatarUrl}`);
        }
      })
      .catch(() => {});
  }, [user?.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({ displayName });
      await refreshUser();
      setEditing(false);
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = () => {
    Alert.alert("Change Photo", "Choose an option", [
      { text: "Camera", onPress: takePhoto },
      { text: "Gallery", onPress: pickFromGallery },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission needed", "Please allow media access"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, aspect: [1, 1], allowsEditing: true });
    if (!result.canceled && result.assets[0]) await doUploadAvatar(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission needed", "Please allow camera access"); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8, aspect: [1, 1], allowsEditing: true });
    if (!result.canceled && result.assets[0]) await doUploadAvatar(result.assets[0].uri);
  };

  const doUploadAvatar = async (uri: string) => {
    setUploadingAvatar(true);
    try {
      const name = `avatar_${Date.now()}.jpg`;
      const { url } = await uploadAvatar(uri, name, "image/jpeg");
      const fullUrl = url.startsWith("http") ? url : `${APP_BASE}${url}`;
      setAvatarUrl(fullUrl);
      await updateProfile({ avatarUrl: fullUrl });
      await refreshUser();
      Alert.alert("Success", "Profile photo updated!");
    } catch {
      Alert.alert("Error", "Failed to upload photo");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: logout },
    ]);
  };

  const initials = (displayName || user?.firstName || "?")
    .split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
    >
      <Text style={styles.headerTitle}>Profile</Text>

      {/* Avatar */}
      <View style={styles.avatarSection}>
        <TouchableOpacity onPress={handleAvatarChange} style={styles.avatarWrapper}>
          {uploadingAvatar ? (
            <View style={styles.avatarPlaceholder}><ActivityIndicator color="#fff" /></View>
          ) : avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}
          <View style={styles.cameraOverlay}>
            <Ionicons name="camera" size={16} color="#fff" />
          </View>
        </TouchableOpacity>
        <Text style={styles.userName}>{user?.firstName || "User"}</Text>
        <Text style={styles.userHandle}>@{(user as any)?.username || user?.email}</Text>
      </View>

      {/* Info section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Info</Text>

        {editing ? (
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Display Name</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor={C.muted}
              autoFocus
              selectionColor={C.primary}
            />
            <View style={styles.editActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.card} onPress={() => { setDisplayName(user?.firstName || ""); setEditing(true); }}>
            <View style={styles.fieldRow}>
              <View>
                <Text style={styles.fieldLabel}>Display Name</Text>
                <Text style={styles.fieldValue}>{user?.firstName || "Set your name"}</Text>
              </View>
              <Ionicons name="pencil-outline" size={18} color={C.muted} />
            </View>
          </TouchableOpacity>
        )}

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Email</Text>
          <Text style={styles.fieldValue}>{user?.email}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Username</Text>
          <Text style={styles.fieldValue}>@{(user as any)?.username || "—"}</Text>
        </View>
      </View>

      {/* Security section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy & Security</Text>

        <TouchableOpacity style={styles.card} onPress={() => setShowAppLock(true)}>
          <View style={styles.fieldRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <Ionicons name="lock-closed" size={20} color={C.primary} />
              <View>
                <Text style={styles.fieldValue}>App Lock</Text>
                <Text style={styles.fieldLabel}>
                  {lockSettings.enabled
                    ? `Enabled • ${lockSettings.lockType === "pin" ? "PIN" : lockSettings.lockType === "fingerprint" ? "Fingerprint" : "Face ID"}`
                    : hasPin ? "Disabled (PIN set)" : "Not configured"}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.muted} />
          </View>
        </TouchableOpacity>

        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark" size={20} color={C.primary} />
            <Text style={styles.infoText}>Messages are end-to-end encrypted</Text>
          </View>
        </View>
      </View>

      {/* Appearance section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.card}>
          {(
            [
              { id: "dark" as ThemeMode, label: "Dark Mode", icon: "moon", desc: "Dark background" },
              { id: "light" as ThemeMode, label: "Light Mode", icon: "sunny", desc: "Light background" },
              { id: "system" as ThemeMode, label: "System Default", icon: "phone-portrait", desc: "Follow device setting" },
            ] as { id: ThemeMode; label: string; icon: string; desc: string }[]
          ).map((opt, idx) => (
            <TouchableOpacity
              key={opt.id}
              style={[styles.fieldRow, { paddingVertical: 10, borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: C.border }]}
              onPress={() => setThemeMode(opt.id)}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
                <View style={{
                  width: 36, height: 36, borderRadius: 10,
                  backgroundColor: themeMode === opt.id ? `${C.primary}20` : C.border,
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons name={opt.icon as any} size={18} color={themeMode === opt.id ? C.primary : C.muted} />
                </View>
                <View>
                  <Text style={[styles.fieldValue, { fontSize: 14 }]}>{opt.label}</Text>
                  <Text style={styles.fieldLabel}>{opt.desc}</Text>
                </View>
              </View>
              {themeMode === opt.id && <Ionicons name="checkmark-circle" size={20} color={C.primary} />}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={20} color={C.danger} />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>

      {showAppLock && <AppLockModal onClose={() => setShowAppLock(false)} />}
    </ScrollView>
  );
}
