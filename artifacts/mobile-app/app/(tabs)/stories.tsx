import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image,
  Dimensions, Animated, TextInput, Alert, ActivityIndicator,
  Modal, ScrollView, Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/contexts/AuthContext";
import {
  getStories, createTextStory, createMediaStory, viewStory,
  reactToStory, deleteStory, APP_BASE,
  Story, StoryGroup,
} from "@/lib/api";
import { Video, ResizeMode } from "expo-av";

const { width: SW, height: SH } = Dimensions.get("window");

const C = {
  bg: "#0a0a0f", card: "#111118", border: "#1f1f2e",
  primary: "#10b981", muted: "#6b7280", text: "#ffffff",
  danger: "#ef4444",
};

const REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "👏"];

const BG_COLORS = [
  "#1a1a2e", "#16213e", "#0f3460", "#533483",
  "#2c003e", "#1b1b2f", "#2e4057", "#048a81",
];

function groupStories(stories: Story[]): StoryGroup[] {
  const map = new Map<string, StoryGroup>();
  for (const s of stories) {
    if (!map.has(s.userId)) {
      map.set(s.userId, {
        userId: s.userId,
        userName: s.userName,
        userAvatar: s.userAvatar,
        stories: [],
        hasUnviewed: false,
      });
    }
    const g = map.get(s.userId)!;
    g.stories.push(s);
    if (!s.hasViewed) g.hasUnviewed = true;
  }
  return Array.from(map.values());
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "Just now";
}

/* ─────────────────── STORY VIEWER ─────────────────── */
function StoryViewer({
  group, onClose, onDelete, currentUserId,
}: {
  group: StoryGroup;
  onClose: () => void;
  onDelete: (id: number) => void;
  currentUserId: string;
}) {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [showReactions, setShowReactions] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressValueRef = useRef(0);
  const indexRef = useRef(index);
  indexRef.current = index;
  const story = group.stories[index];
  const isOwn = story?.userId === currentUserId;

  function goNext() {
    if (progressRef.current) clearInterval(progressRef.current);
    progressRef.current = null;
    const current = indexRef.current;
    if (current < group.stories.length - 1) {
      setIndex(current + 1);
    } else {
      setTimeout(() => onClose(), 0);
    }
  }
  function goPrev() {
    if (progressRef.current) clearInterval(progressRef.current);
    progressRef.current = null;
    const current = indexRef.current;
    if (current > 0) setIndex(current - 1);
  }

  useEffect(() => {
    if (!story) return;
    if (progressRef.current) clearInterval(progressRef.current);
    progressValueRef.current = 0;
    setProgress(0);
    const dur = story.type === "video" ? 15000 : 5000;
    const step = 100 / (dur / 100);
    progressRef.current = setInterval(() => {
      progressValueRef.current += step;
      if (progressValueRef.current >= 100) {
        clearInterval(progressRef.current!);
        progressRef.current = null;
        setProgress(100);
        goNext();
      } else {
        setProgress(progressValueRef.current);
      }
    }, 100);
    viewStory(story.id).catch(() => {});
    return () => { if (progressRef.current) clearInterval(progressRef.current); };
  }, [index, story?.id]);

  if (!story) return null;

  const mediaUrl = story.mediaUrl?.startsWith("http") ? story.mediaUrl : story.mediaUrl ? `${APP_BASE}${story.mediaUrl}` : null;

  return (
    <View style={sv.container}>
      {/* Progress bars */}
      <View style={sv.progressRow}>
        {group.stories.map((s, i) => (
          <View key={s.id} style={sv.progressTrack}>
            <View style={[
              sv.progressFill,
              { width: i < index ? "100%" : i === index ? `${progress}%` : "0%" },
            ]} />
          </View>
        ))}
      </View>

      {/* Header */}
      <View style={sv.header}>
        <View style={sv.avatarSmall}>
          {group.userAvatar
            ? <Image source={{ uri: group.userAvatar.startsWith("http") ? group.userAvatar : `${APP_BASE}${group.userAvatar}` }} style={{ width: 36, height: 36, borderRadius: 18 }} />
            : <Ionicons name="person" size={18} color="#fff" />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sv.userName}>{group.userName || "User"}</Text>
          <Text style={sv.timeAgo}>{timeAgo(story.createdAt)}</Text>
        </View>
        {isOwn && (
          <TouchableOpacity style={sv.iconBtn} onPress={() => {
            Alert.alert("Delete Story", "Delete this story?", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => { onDelete(story.id); goNext(); } },
            ]);
          }}>
            <Ionicons name="trash-outline" size={20} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={sv.iconBtn} onPress={onClose}>
          <Ionicons name="close" size={24} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={sv.content}>
        <Pressable style={sv.tapLeft} onPress={goPrev} />
        <Pressable style={sv.tapRight} onPress={goNext} />

        {story.type === "text" && (
          <View style={[sv.textBg, { backgroundColor: story.backgroundColor || "#1a1a2e" }]}>
            <Text style={[sv.textContent, { color: story.textColor || "#fff" }]}>{story.content}</Text>
          </View>
        )}
        {story.type === "image" && mediaUrl && (
          <Image source={{ uri: mediaUrl }} style={sv.media} resizeMode="contain" />
        )}
        {story.type === "video" && mediaUrl && (
          <Video
            source={{ uri: mediaUrl }}
            style={sv.media}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay
            isLooping
          />
        )}
      </View>

      {/* Bottom */}
      <View style={sv.bottom}>
        {isOwn ? (
          <TouchableOpacity style={sv.bottomBtn} onPress={() => setShowViewers(v => !v)}>
            <Ionicons name="eye-outline" size={20} color="rgba(255,255,255,0.8)" />
            <Text style={sv.bottomBtnText}>{story.viewCount} viewer{story.viewCount !== 1 ? "s" : ""}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={sv.bottomBtn} onPress={() => setShowReactions(r => !r)}>
            <Ionicons name="happy-outline" size={20} color="rgba(255,255,255,0.8)" />
            <Text style={sv.bottomBtnText}>React</Text>
          </TouchableOpacity>
        )}
        {story.reactions.length > 0 && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {[...new Set(story.reactions.map(r => r.emoji))].slice(0, 3).map(e => (
              <Text key={e} style={{ fontSize: 20 }}>{e}</Text>
            ))}
          </View>
        )}
      </View>

      {/* Reactions */}
      {showReactions && (
        <View style={sv.reactionsRow}>
          {REACTIONS.map(e => (
            <TouchableOpacity key={e} onPress={async () => {
              await reactToStory(story.id, e).catch(() => {});
              setShowReactions(false);
            }}>
              <Text style={{ fontSize: 36 }}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Viewers */}
      {showViewers && (
        <View style={sv.viewersSheet}>
          <Text style={sv.viewersTitle}>Viewed by ({story.views.length})</Text>
          {story.views.length === 0
            ? <Text style={{ color: C.muted, fontSize: 14 }}>No views yet</Text>
            : story.views.map((v: any) => (
              <View key={v.viewerId} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#ffffff20", alignItems: "center", justifyContent: "center" }}>
                  {v.viewerAvatar
                    ? <Image source={{ uri: v.viewerAvatar }} style={{ width: 36, height: 36, borderRadius: 18 }} />
                    : <Text style={{ color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" }}>{(v.viewerName || "?")[0].toUpperCase()}</Text>
                  }
                </View>
                <Text style={{ color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 }}>{v.viewerName}</Text>
                {v.reaction ? (
                  <Text style={{ fontSize: 20 }}>{v.reaction}</Text>
                ) : null}
              </View>
            ))
          }
        </View>
      )}
    </View>
  );
}

/* ─────────────────── CREATE STORY ─────────────────── */
function CreateStoryModal({ onClose, onCreated }: { onClose: () => void; onCreated: (s: Story) => void }) {
  const [mode, setMode] = useState<"choose" | "text" | "uploading">("choose");
  const [text, setText] = useState("");
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
  const [textColor, setTextColor] = useState("#ffffff");

  const pickMedia = async (type: "photo" | "video") => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") { Alert.alert("Permission needed"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: type === "photo" ? ImagePicker.MediaTypeOptions.Images : ImagePicker.MediaTypeOptions.Videos,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mime = asset.type === "video" ? "video/mp4" : "image/jpeg";
    setMode("uploading");
    try {
      const story = await createMediaStory(asset.uri, mime);
      onCreated(story);
      onClose();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Upload failed");
      setMode("choose");
    }
  };

  const postTextStory = async () => {
    if (!text.trim()) return;
    setMode("uploading");
    try {
      const story = await createTextStory({ content: text.trim(), backgroundColor: bgColor, textColor });
      onCreated(story);
      onClose();
    } catch (e: any) {
      Alert.alert("Error", e.message);
      setMode("text");
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {/* Header */}
        <View style={cs.header}>
          <TouchableOpacity onPress={onClose} style={cs.backBtn}>
            <Ionicons name="close" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={cs.title}>Create Story</Text>
          <View style={{ width: 40 }} />
        </View>

        {mode === "uploading" ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={C.primary} size="large" />
            <Text style={{ color: C.muted, marginTop: 16, fontFamily: "Inter_400Regular" }}>Uploading story...</Text>
          </View>
        ) : mode === "text" ? (
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {/* Preview */}
            <View style={[cs.textPreview, { backgroundColor: bgColor }]}>
              <Text style={[cs.textPreviewText, { color: textColor }]}>
                {text || "Type your story..."}
              </Text>
            </View>
            {/* Input */}
            <View style={{ padding: 20 }}>
              <TextInput
                style={cs.textInput}
                value={text}
                onChangeText={setText}
                placeholder="What's on your mind?"
                placeholderTextColor={C.muted}
                multiline
                maxLength={280}
                selectionColor={C.primary}
              />
              <Text style={cs.charCount}>{text.length}/280</Text>

              {/* BG colors */}
              <Text style={cs.label}>Background</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 10, paddingVertical: 8 }}>
                  {BG_COLORS.map(c => (
                    <TouchableOpacity key={c} onPress={() => setBgColor(c)}
                      style={[cs.colorDot, { backgroundColor: c, borderWidth: bgColor === c ? 3 : 0, borderColor: C.primary }]}
                    />
                  ))}
                </View>
              </ScrollView>

              {/* Text colors */}
              <Text style={cs.label}>Text Color</Text>
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                {["#ffffff", "#000000", "#ffd700", "#ff6b6b", "#10b981", "#60a5fa"].map(c => (
                  <TouchableOpacity key={c} onPress={() => setTextColor(c)}
                    style={[cs.colorDot, { backgroundColor: c, borderWidth: textColor === c ? 3 : 0, borderColor: C.primary }]}
                  />
                ))}
              </View>

              <TouchableOpacity
                style={[cs.postBtn, !text.trim() && { opacity: 0.4 }]}
                onPress={postTextStory}
                disabled={!text.trim()}
              >
                <Text style={cs.postBtnText}>Post Story</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : (
          <View style={cs.chooseGrid}>
            <TouchableOpacity style={cs.chooseCard} onPress={() => setMode("text")}>
              <Ionicons name="text" size={40} color={C.primary} />
              <Text style={cs.chooseLabel}>Text</Text>
              <Text style={cs.chooseDesc}>Write a text status</Text>
            </TouchableOpacity>
            <TouchableOpacity style={cs.chooseCard} onPress={() => pickMedia("photo")}>
              <Ionicons name="image-outline" size={40} color="#60a5fa" />
              <Text style={cs.chooseLabel}>Photo</Text>
              <Text style={cs.chooseDesc}>Share a photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={cs.chooseCard} onPress={() => pickMedia("video")}>
              <Ionicons name="videocam-outline" size={40} color="#f472b6" />
              <Text style={cs.chooseLabel}>Video</Text>
              <Text style={cs.chooseDesc}>Share a video clip</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

/* ─────────────────── MAIN SCREEN ─────────────────── */
export default function StoriesScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingGroup, setViewingGroup] = useState<StoryGroup | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchStories = useCallback(async () => {
    try {
      const data = await getStories();
      setGroups(groupStories(data));
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStories(); }, []);

  const handleDelete = async (storyId: number) => {
    try {
      await deleteStory(storyId);
      setGroups(gs => gs.map(g => ({ ...g, stories: g.stories.filter(s => s.id !== storyId) })).filter(g => g.stories.length > 0));
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const myGroup = groups.find(g => g.userId === user?.id);
  const othersGroups = groups.filter(g => g.userId !== user?.id);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={[ss.header, { paddingTop: insets.top + 12 }]}>
        <Text style={ss.title}>Stories</Text>
        <TouchableOpacity style={ss.addBtn} onPress={() => setShowCreate(true)}>
          <Ionicons name="add" size={22} color={C.text} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={[]}
          ListHeaderComponent={() => (
            <View>
              {/* My Story */}
              <Text style={ss.sectionLabel}>My Story</Text>
              <TouchableOpacity style={ss.myStoryCard} onPress={() => myGroup ? setViewingGroup(myGroup) : setShowCreate(true)}>
                <View style={[ss.myAvatarRing, myGroup && ss.activeRing]}>
                  {user?.profileImageUrl
                    ? <Image source={{ uri: user.profileImageUrl.startsWith("http") ? user.profileImageUrl : `${APP_BASE}${user.profileImageUrl}` }} style={ss.myAvatar} />
                    : <View style={[ss.myAvatar, { backgroundColor: C.primary, alignItems: "center", justifyContent: "center" }]}>
                        <Text style={{ fontSize: 24, color: "#fff", fontFamily: "Inter_700Bold" }}>
                          {(user?.firstName || "?")[0].toUpperCase()}
                        </Text>
                      </View>
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ss.myStoryName}>My Story</Text>
                  <Text style={ss.myStoryMeta}>
                    {myGroup ? `${myGroup.stories.length} update${myGroup.stories.length !== 1 ? "s" : ""}` : "Tap to add a story"}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setShowCreate(true)} style={ss.plusCircle}>
                  <Ionicons name="add" size={20} color={C.primary} />
                </TouchableOpacity>
              </TouchableOpacity>

              {/* Others' stories */}
              {othersGroups.length > 0 && (
                <>
                  <Text style={[ss.sectionLabel, { marginTop: 24 }]}>Recent Updates</Text>
                  {othersGroups.map(g => (
                    <TouchableOpacity key={g.userId} style={ss.storyCard} onPress={() => setViewingGroup(g)}>
                      <View style={[ss.avatarRing, g.hasUnviewed && ss.unviewedRing]}>
                        {g.userAvatar
                          ? <Image source={{ uri: g.userAvatar.startsWith("http") ? g.userAvatar : `${APP_BASE}${g.userAvatar}` }} style={ss.avatarImg} />
                          : <View style={[ss.avatarImg, { backgroundColor: C.primary, alignItems: "center", justifyContent: "center" }]}>
                              <Text style={{ fontSize: 22, color: "#fff", fontFamily: "Inter_700Bold" }}>
                                {(g.userName || "?")[0].toUpperCase()}
                              </Text>
                            </View>
                        }
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={ss.storyUserName}>{g.userName || "User"}</Text>
                        <Text style={ss.storyMeta}>{timeAgo(g.stories[0].createdAt)}</Text>
                      </View>
                      {g.hasUnviewed && <View style={ss.unviewedDot} />}
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {groups.length === 0 && !loading && (
                <View style={ss.emptyBox}>
                  <Ionicons name="sparkles-outline" size={60} color={C.muted} />
                  <Text style={ss.emptyText}>No stories yet</Text>
                  <Text style={ss.emptyDesc}>Share a story and let your contacts know what's on your mind</Text>
                  <TouchableOpacity style={ss.emptyBtn} onPress={() => setShowCreate(true)}>
                    <Ionicons name="add-circle-outline" size={20} color="#fff" />
                    <Text style={ss.emptyBtnText}>Add Your First Story</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
          renderItem={() => null}
          keyExtractor={() => ""}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20, padding: 16 }}
        />
      )}

      {/* Story Viewer */}
      {viewingGroup && (
        <Modal visible animationType="fade" presentationStyle="fullScreen">
          <StoryViewer
            group={viewingGroup}
            onClose={() => { setTimeout(() => { setViewingGroup(null); fetchStories(); }, 0); }}
            onDelete={handleDelete}
            currentUserId={user?.id || ""}
          />
        </Modal>
      )}

      {/* Create Story */}
      {showCreate && (
        <CreateStoryModal
          onClose={() => setShowCreate(false)}
          onCreated={story => {
            setGroups(gs => {
              const uid = story.userId;
              const idx = gs.findIndex(g => g.userId === uid);
              if (idx >= 0) {
                const updated = [...gs];
                updated[idx] = { ...updated[idx], stories: [story, ...updated[idx].stories] };
                return updated;
              }
              return [{ userId: uid, userName: story.userName, userAvatar: story.userAvatar, stories: [story], hasUnviewed: false }, ...gs];
            });
          }}
        />
      )}
    </View>
  );
}

/* ─────────────────── STYLES ─────────────────── */
const sv = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  progressRow: { flexDirection: "row", gap: 4, paddingHorizontal: 12, paddingTop: 52, paddingBottom: 4 },
  progressTrack: { flex: 1, height: 3, backgroundColor: "rgba(255,255,255,0.3)", borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#fff", borderRadius: 2 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  avatarSmall: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  userName: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  timeAgo: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontFamily: "Inter_400Regular" },
  iconBtn: { padding: 6 },
  content: { flex: 1, position: "relative" },
  tapLeft: { position: "absolute", left: 0, top: 0, bottom: 0, width: "33%" },
  tapRight: { position: "absolute", right: 0, top: 0, bottom: 0, width: "33%" },
  textBg: { position: "absolute", inset: 0, flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  textContent: { fontSize: 24, fontFamily: "Inter_700Bold", textAlign: "center", lineHeight: 34 },
  media: { width: "100%", height: "100%" },
  bottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16 },
  bottomBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  bottomBtnText: { color: "rgba(255,255,255,0.8)", fontSize: 14, fontFamily: "Inter_400Regular" },
  reactionsRow: { position: "absolute", bottom: 64, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 16, padding: 16 },
  viewersSheet: {
    position: "absolute", bottom: 64, left: 0, right: 0,
    backgroundColor: "rgba(0,0,0,0.92)", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: 300,
  },
  viewersTitle: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14, marginBottom: 12 },
});

const cs = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 56, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, color: C.text, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  chooseGrid: { flex: 1, justifyContent: "center", alignItems: "center", gap: 20, padding: 32 },
  chooseCard: {
    width: "100%", backgroundColor: C.card, borderRadius: 16,
    padding: 24, alignItems: "center", gap: 8,
    borderWidth: 1, borderColor: C.border,
  },
  chooseLabel: { fontSize: 18, color: C.text, fontFamily: "Inter_600SemiBold" },
  chooseDesc: { fontSize: 13, color: C.muted, fontFamily: "Inter_400Regular" },
  textPreview: { height: 220, alignItems: "center", justifyContent: "center", padding: 32 },
  textPreviewText: { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  textInput: {
    backgroundColor: "#1a1a2e", borderRadius: 12, padding: 16,
    fontSize: 16, color: C.text, minHeight: 100,
    textAlignVertical: "top", fontFamily: "Inter_400Regular",
    borderWidth: 1, borderColor: C.border,
  },
  charCount: { fontSize: 11, color: C.muted, textAlign: "right", marginTop: 4, fontFamily: "Inter_400Regular" },
  label: { fontSize: 13, color: C.muted, fontFamily: "Inter_500Medium", marginTop: 16, marginBottom: 4 },
  colorDot: { width: 36, height: 36, borderRadius: 18 },
  postBtn: { backgroundColor: C.primary, borderRadius: 12, padding: 16, alignItems: "center", marginTop: 24 },
  postBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});

const ss = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 8 },
  title: { fontSize: 24, color: C.text, fontFamily: "Inter_700Bold" },
  addBtn: { width: 40, height: 40, backgroundColor: C.card, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },
  sectionLabel: { fontSize: 13, color: C.muted, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  myStoryCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  myAvatarRing: { width: 60, height: 60, borderRadius: 30, padding: 2, borderWidth: 2, borderColor: C.border, overflow: "hidden" },
  activeRing: { borderColor: C.primary },
  myAvatar: { width: 52, height: 52, borderRadius: 26 },
  myStoryName: { fontSize: 15, color: C.text, fontFamily: "Inter_600SemiBold" },
  myStoryMeta: { fontSize: 13, color: C.muted, fontFamily: "Inter_400Regular", marginTop: 2 },
  plusCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#10b98120", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#10b98140" },
  storyCard: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  avatarRing: { width: 58, height: 58, borderRadius: 29, padding: 2, borderWidth: 2, borderColor: C.border, overflow: "hidden" },
  unviewedRing: { borderColor: C.primary },
  avatarImg: { width: 50, height: 50, borderRadius: 25 },
  storyUserName: { fontSize: 15, color: C.text, fontFamily: "Inter_600SemiBold" },
  storyMeta: { fontSize: 13, color: C.muted, fontFamily: "Inter_400Regular", marginTop: 2 },
  unviewedDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },
  emptyBox: { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 20, color: C.text, fontFamily: "Inter_600SemiBold" },
  emptyDesc: { fontSize: 14, color: C.muted, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 32 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, marginTop: 8 },
  emptyBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
