import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";

export default function AuthScreen() {
  const { login, register } = useAuth();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Please enter your email and password");
      return;
    }
    if (mode === "register" && !username) {
      Alert.alert("Error", "Please enter your name");
      return;
    }
    setIsLoading(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, username.trim());
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#0a0a0f" }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>🔒</Text>
          </View>
          <Text style={styles.appName}>Private</Text>
          <Text style={styles.tagline}>Secure Messaging</Text>
        </View>

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, mode === "login" && styles.activeTab]}
            onPress={() => setMode("login")}
          >
            <Text style={[styles.tabText, mode === "login" && styles.activeTabText]}>
              Login
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === "register" && styles.activeTab]}
            onPress={() => setMode("register")}
          >
            <Text style={[styles.tabText, mode === "register" && styles.activeTabText]}>
              Register
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.form}>
          {mode === "register" && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Your name"
                placeholderTextColor="#4b5563"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="words"
              />
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="email@example.com"
              placeholderTextColor="#4b5563"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="••••••••"
                placeholderTextColor="#4b5563"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(!showPassword)}
              >
                <Text style={styles.eyeIcon}>{showPassword ? "🙈" : "👁️"}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {mode === "login" ? "Login" : "Create Account"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  header: {
    alignItems: "center",
    marginBottom: 40,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: "#10b98120",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  icon: {
    fontSize: 36,
  },
  appName: {
    fontSize: 32,
    fontWeight: "700",
    color: "#ffffff",
    fontFamily: "Inter_700Bold",
    marginBottom: 8,
  },
  tagline: {
    fontSize: 15,
    color: "#6b7280",
    fontFamily: "Inter_400Regular",
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 4,
    marginBottom: 32,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 10,
  },
  activeTab: {
    backgroundColor: "#10b981",
  },
  tabText: {
    fontSize: 15,
    color: "#6b7280",
    fontFamily: "Inter_600SemiBold",
  },
  activeTabText: {
    color: "#ffffff",
  },
  form: {
    gap: 20,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    color: "#9ca3af",
    fontFamily: "Inter_500Medium",
  },
  input: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#ffffff",
    borderWidth: 1,
    borderColor: "#2d2d3f",
    fontFamily: "Inter_400Regular",
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2d2d3f",
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#ffffff",
    fontFamily: "Inter_400Regular",
  },
  eyeButton: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  eyeIcon: {
    fontSize: 18,
  },
  button: {
    backgroundColor: "#10b981",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
});
