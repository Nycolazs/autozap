import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Audio, AVPlaybackStatusSuccess } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../context/AppThemeContext';
import { mergeThemedStyles } from '../lib/themeStyles';
import { lightColors } from '../theme';

type AudioMessagePlayerProps = {
  uri: string;
  isOutgoing?: boolean;
};

function formatAudioTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function AudioMessagePlayer({ uri, isOutgoing = false }: AudioMessagePlayerProps) {
  const { isDark, colors } = useAppTheme();
  const styles = useMemo(
    () => mergeThemedStyles(lightStyles, darkStyles, isDark),
    [isDark]
  );
  const soundRef = useRef<Audio.Sound | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [positionMs, setPositionMs] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);

  const progress = useMemo(() => {
    if (!durationMs) return 0;
    return Math.max(0, Math.min(1, positionMs / durationMs));
  }, [durationMs, positionMs]);
  const progressPercent = useMemo(() => Math.max(0, Math.min(100, progress * 100)), [progress]);
  const knobPercent = useMemo(() => Math.max(0, Math.min(98, progressPercent)), [progressPercent]);

  const unloadSound = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;

    try {
      await sound.stopAsync();
    } catch (_) {}

    try {
      await sound.unloadAsync();
    } catch (_) {}

    soundRef.current = null;
    setPlaying(false);
    setPositionMs(0);
  }, []);

  const handleStatusUpdate = useCallback((status: unknown) => {
    if (!status || typeof status !== 'object' || !('isLoaded' in status)) {
      setPlaying(false);
      return;
    }

    const loaded = status as AVPlaybackStatusSuccess;
    if (!loaded.isLoaded) {
      setPlaying(false);
      return;
    }

    const duration = Number(loaded.durationMillis || 0);
    const position = Number(loaded.positionMillis || 0);
    setDurationMs(duration);
    setPositionMs(position);
    setPlaying(!!loaded.isPlaying);

    if (loaded.didJustFinish) {
      setPlaying(false);
      setPositionMs(Number(loaded.durationMillis || loaded.positionMillis || 0));
    }
  }, []);

  const ensureSound = useCallback(async (): Promise<Audio.Sound> => {
    if (soundRef.current) return soundRef.current;

    const { sound, status } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: false, isLooping: false, progressUpdateIntervalMillis: 180 },
      handleStatusUpdate
    );

    try {
      await sound.setIsLoopingAsync(false);
    } catch (_) {}

    soundRef.current = sound;
    handleStatusUpdate(status);
    return sound;
  }, [handleStatusUpdate, uri]);

  const togglePlayback = useCallback(async () => {
    if (loading) return;
    setLoading(true);

    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const sound = await ensureSound();
      const status = await sound.getStatusAsync();

      if (!status.isLoaded) return;

      if (status.isPlaying) {
        await sound.pauseAsync();
      } else {
        if (status.positionMillis >= (status.durationMillis || 0) && (status.durationMillis || 0) > 0) {
          await sound.setPositionAsync(0);
        }
        await sound.playAsync();
      }
    } catch (_) {
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  }, [ensureSound, loading]);

  const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const handleSeek = useCallback(async (locationX: number) => {
    if (!durationMs || !trackWidth) return;
    const sound = soundRef.current;
    if (!sound) return;

    const ratio = Math.max(0, Math.min(1, locationX / trackWidth));
    const target = Math.floor(durationMs * ratio);
    try {
      await sound.setPositionAsync(target);
      setPositionMs(target);
    } catch (_) {}
  }, [durationMs, trackWidth]);

  useEffect(() => {
    return () => {
      void unloadSound();
    };
  }, [unloadSound]);

  return (
    <View style={[styles.container, isOutgoing ? styles.containerOutgoing : null]}>
      <Pressable onPress={() => void togglePlayback()} style={[styles.playButton, isOutgoing ? styles.playButtonOutgoing : null]}>
        {loading ? (
          <ActivityIndicator size="small" color={isOutgoing ? '#005c4b' : colors.primaryStrong} />
        ) : (
          <Ionicons
            name={playing ? 'pause' : 'play'}
            size={18}
            color={isOutgoing ? '#005c4b' : colors.primaryStrong}
            style={!playing ? styles.playIconOffset : null}
          />
        )}
      </Pressable>

      <View style={styles.waveSection}>
        <Pressable onLayout={handleTrackLayout} onPress={(e) => void handleSeek(e.nativeEvent.locationX)} style={styles.trackWrap}>
          <View style={styles.trackBase} />
          <View style={[styles.trackProgress, { width: `${progressPercent}%` }]} />
          <View style={[styles.trackKnob, { left: `${knobPercent}%` }]} />
        </Pressable>

        <View style={styles.metaRow}>
          <Ionicons name="mic" size={12} color={isOutgoing ? '#0a6a5a' : '#607284'} />
          <Text style={styles.metaText}>{formatAudioTime(durationMs || positionMs)}</Text>
        </View>
      </View>
    </View>
  );
}

const lightStyles = StyleSheet.create({
  container: {
    minWidth: 210,
    maxWidth: 285,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f4f8ff',
    borderWidth: 1,
    borderColor: '#cbd8e8',
  },
  containerOutgoing: {
    backgroundColor: '#dff2d7',
    borderColor: '#c1ddba',
  },
  playButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e4ecfb',
  },
  playButtonOutgoing: {
    backgroundColor: '#cae7d5',
  },
  playIconOffset: {
    marginLeft: 2,
  },
  waveSection: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  trackWrap: {
    height: 18,
    justifyContent: 'center',
  },
  trackBase: {
    height: 5,
    borderRadius: 999,
    backgroundColor: '#cfd8e4',
  },
  trackProgress: {
    position: 'absolute',
    left: 0,
    height: 5,
    borderRadius: 999,
    backgroundColor: lightColors.primaryStrong,
  },
  trackKnob: {
    position: 'absolute',
    marginLeft: -5,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: lightColors.primaryStrong,
    top: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#667781',
    fontWeight: '600',
  },
});

const darkStyles = StyleSheet.create({
  container: {
    backgroundColor: '#102636',
    borderColor: '#29435c',
  },
  containerOutgoing: {
    backgroundColor: '#13463e',
    borderColor: '#1f6658',
  },
  playButton: {
    backgroundColor: '#1f3852',
  },
  playButtonOutgoing: {
    backgroundColor: '#1f6658',
  },
  trackBase: {
    backgroundColor: '#36506a',
  },
  metaText: {
    color: '#b7c9da',
  },
});
