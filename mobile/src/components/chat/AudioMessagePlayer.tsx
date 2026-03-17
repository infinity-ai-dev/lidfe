import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Image, Platform, View, StyleSheet, TouchableOpacity } from 'react-native';
import { Icon, Text, useTheme } from 'react-native-paper';
import { Audio as ExpoAudio } from 'expo-av';
import { useFontScale } from '@/hooks/useFontScale';

const LIDFE_LOGO = require('../../../assets/images/logo_LIDFE_new-Photoroom.png');

export type AudioPlayerControls = {
  play: () => Promise<void> | void;
  pause: () => Promise<void> | void;
  stopAndReset: () => Promise<void> | void;
};

interface AudioMessagePlayerProps {
  messageId: string;
  audioBase64: string;
  mimeType?: string | null;
  // Define cores de contraste conforme o remetente do balão.
  isUser?: boolean;
  // Timestamp da mensagem para exibir no balão.
  createdAt?: string | null;
  registerControls?: (id: string, controls: AudioPlayerControls) => (() => void) | void;
  onPlayRequest?: (id: string) => void;
  onPauseRequest?: (id: string) => void;
  onPlaybackEnd?: (id: string) => void;
}

export function AudioMessagePlayer({
  messageId,
  audioBase64,
  mimeType,
  isUser = false,
  createdAt,
  registerControls,
  onPlayRequest,
  onPauseRequest,
  onPlaybackEnd,
}: AudioMessagePlayerProps) {
  const theme = useTheme();
  const { scale } = useFontScale();
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [position, setPosition] = useState<number>(0);
  const soundRef = useRef<ExpoAudio.Sound | null>(null);
  const loadingRef = useRef(false);
  const loadingPromiseRef = useRef<Promise<void> | null>(null);
  // Web: manter referência do HTMLAudioElement para garantir playback no navegador.
  const webAudioRef = useRef<any>(null);
  const webAudioUrlRef = useRef<string | null>(null);
  // Ajuste visual do balão conforme remetente.
  const foregroundColor = isUser ? theme.colors.onPrimary : theme.colors.onSurfaceVariant;
  const playBackground = isUser ? theme.colors.primary : theme.colors.surfaceVariant;
  const waveformHeights = useMemo(
    () => [6, 10, 14, 8, 12, 18, 10, 16, 9, 13, 7, 15, 11, 17, 9, 12],
    []
  );

  const cleanupAudio = useCallback(() => {
    if (soundRef.current) {
      soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    if (webAudioRef.current) {
      webAudioRef.current.pause?.();
      webAudioRef.current = null;
    }
    if (webAudioUrlRef.current) {
      URL.revokeObjectURL(webAudioUrlRef.current);
      webAudioUrlRef.current = null;
    }
    loadingRef.current = false;
    loadingPromiseRef.current = null;
    setIsPlaying(false);
    setDuration(null);
    setPosition(0);
  }, []);

  const normalizeBase64 = (value: string): { data: string; mime?: string } => {
    if (value.startsWith('data:audio/')) {
      const [meta, data] = value.split(',');
      const match = meta.match(/data:(audio\/[^;]+)/);
      return { data: data || '', mime: match?.[1] };
    }

    return { data: value };
  };

  const detectMimeType = (base64: string): { mime: string; data: string } => {
    const normalized = normalizeBase64(base64);
    const data = normalized.data;

    if (mimeType) {
      return { mime: mimeType, data };
    }

    if (normalized.mime) {
      return { mime: normalized.mime, data };
    }

    if (data.startsWith('UklGR')) return { mime: 'audio/wav', data };
    if (data.startsWith('T2dnUw')) return { mime: 'audio/ogg', data };
    if (data.startsWith('GkXf')) return { mime: 'audio/webm', data };
    if (data.startsWith('AAAA')) return { mime: 'audio/mp4', data };
    if (data.startsWith('SUQz') || data.startsWith('/+my')) {
      return { mime: 'audio/mpeg', data };
    }

    return { mime: 'audio/wav', data };
  };

  const buildWebAudio = (base64: string, mime: string) => {
    // Web: criar AudioElement a partir de Blob para evitar falhas do expo-av no navegador.
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const AudioCtor = typeof globalThis !== 'undefined' ? (globalThis as any).Audio : undefined;
    if (!AudioCtor) {
      throw new Error('HTMLAudioElement não disponível no ambiente web.');
    }
    const audio = new AudioCtor(url);

    if (webAudioUrlRef.current) {
      URL.revokeObjectURL(webAudioUrlRef.current);
    }

    webAudioUrlRef.current = url;
    webAudioRef.current = audio;

    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) {
        setDuration(Math.floor(audio.duration * 1000));
      }
    };

    audio.ontimeupdate = () => {
      setPosition(Math.floor(audio.currentTime * 1000));
    };

    audio.onended = () => {
      setIsPlaying(false);
      setPosition(0);
      if (onPlaybackEnd) {
        onPlaybackEnd(messageId);
      }
    };

    return audio;
  };

  const loadAudio = useCallback(async () => {
    if (!audioBase64) return;
    if (Platform.OS === 'web' && webAudioRef.current) return;
    if (Platform.OS !== 'web' && soundRef.current) return;
    if (loadingRef.current && loadingPromiseRef.current) {
      await loadingPromiseRef.current;
      return;
    }

    loadingRef.current = true;
    const loader = (async () => {
      try {
        const { mime, data } = detectMimeType(audioBase64);
        if (!data) {
          return;
        }

        if (Platform.OS === 'web') {
          buildWebAudio(data, mime);
          return;
        }

        const uri = `data:${mime};base64,${data}`;

        await ExpoAudio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
        });

        const { sound: audioSound } = await ExpoAudio.Sound.createAsync(
          { uri },
          { shouldPlay: false }
        );

        const status = await audioSound.getStatusAsync();
        if (status.isLoaded) {
          setDuration(status.durationMillis || null);
        }

        audioSound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded) {
            setIsPlaying(status.isPlaying);
            setPosition(status.positionMillis || 0);
            if (status.durationMillis) {
              setDuration(status.durationMillis);
            }

            if (status.didJustFinish) {
              setIsPlaying(false);
              setPosition(0);
              if (onPlaybackEnd) {
                onPlaybackEnd(messageId);
              }
            }
          }
        });

        soundRef.current = audioSound;
      } catch (error) {
        console.error('[AUDIO] Erro ao carregar áudio:', error);
      }
    })();

    loadingPromiseRef.current = loader;
    await loader;
    loadingPromiseRef.current = null;
    loadingRef.current = false;
  }, [audioBase64, messageId, mimeType, onPlaybackEnd]);

  useEffect(() => {
    loadAudio();
    return () => {
      cleanupAudio();
    };
  }, [audioBase64, cleanupAudio, loadAudio, mimeType]);

  const play = useCallback(async () => {
    try {
      if (Platform.OS === 'web') {
        if (!webAudioRef.current) {
          await loadAudio();
        }
        const audio = webAudioRef.current;
        if (!audio) return;
        await audio.play?.();
        setIsPlaying(true);
        return;
      }

      if (!soundRef.current) {
        await loadAudio();
      }
      const audioSound = soundRef.current;
      if (!audioSound) return;
      await audioSound.playAsync();
    } catch (error) {
      console.error('[AUDIO] Erro ao tocar:', error);
    }
  }, [loadAudio]);

  const pause = useCallback(async () => {
    try {
      if (Platform.OS === 'web') {
        const audio = webAudioRef.current;
        if (!audio) return;
        audio.pause?.();
        setIsPlaying(false);
        return;
      }

      if (!soundRef.current) return;
      await soundRef.current.pauseAsync();
    } catch (error) {
      console.error('[AUDIO] Erro ao pausar:', error);
    }
  }, []);

  const stopAndReset = useCallback(async () => {
    try {
      if (Platform.OS === 'web') {
        const audio = webAudioRef.current;
        if (!audio) {
          setIsPlaying(false);
          setPosition(0);
          return;
        }
        audio.pause?.();
        audio.currentTime = 0;
        setIsPlaying(false);
        setPosition(0);
        return;
      }

      if (!soundRef.current) {
        setIsPlaying(false);
        setPosition(0);
        return;
      }
      await soundRef.current.pauseAsync();
      await soundRef.current.setPositionAsync(0);
      setIsPlaying(false);
      setPosition(0);
    } catch (error) {
      console.error('[AUDIO] Erro ao resetar:', error);
    }
  }, []);

  useEffect(() => {
    if (!registerControls) return;
    const cleanup = registerControls(messageId, {
      play,
      pause,
      stopAndReset,
    });
    return () => {
      if (typeof cleanup === 'function') {
        cleanup();
      }
    };
  }, [messageId, pause, play, registerControls, stopAndReset]);

  const togglePlayback = async () => {
    if (isPlaying) {
      if (onPauseRequest) {
        onPauseRequest(messageId);
        return;
      }
      await pause();
      return;
    }

    if (onPlayRequest) {
      onPlayRequest(messageId);
      return;
    }
    await play();
  };

  const formatTime = (millis: number | null): string => {
    if (!millis) return '0:00';
    const seconds = Math.floor(millis / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const formatClockTime = (value?: string | null): string => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const timestampLabel = formatClockTime(createdAt);
  const showLogo = !isUser;

  return (
    <View style={styles.container}>
      {showLogo ? (
        <View style={[styles.logoBubble, { borderColor: foregroundColor }]}>
          <Image source={LIDFE_LOGO} style={styles.logo} />
        </View>
      ) : null}
      <TouchableOpacity
        onPress={togglePlayback}
        style={[styles.playButton, { backgroundColor: playBackground, borderColor: foregroundColor }]}
      >
        <Icon
          source={isPlaying ? 'pause' : 'play'}
          color={foregroundColor}
          size={20}
        />
      </TouchableOpacity>
      <View style={styles.content}>
        <View style={styles.waveformRow}>
          {/* Indicador de reprodução, seguindo estilo do exemplo */}
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isPlaying ? theme.colors.primary : foregroundColor },
            ]}
          />
          <View style={styles.waveform}>
            {waveformHeights.map((height, index) => {
              const progressRatio = duration && duration > 0 ? position / duration : 0;
              const progressIndex = Math.round(progressRatio * (waveformHeights.length - 1));
              const isPlayed = isPlaying && index <= progressIndex;
              return (
                <View
                  key={`wave-${index}`}
                  style={[
                    styles.waveformBar,
                    {
                      height,
                      backgroundColor: isPlayed
                        ? (isUser ? theme.colors.onPrimary : theme.colors.primary)
                        : foregroundColor,
                      opacity: isPlayed ? 1 : 0.5,
                    },
                  ]}
                />
              );
            })}
          </View>
        </View>
        <View style={styles.metaRow}>
          <Text
            variant="bodySmall"
            style={[styles.durationText, { color: foregroundColor, fontSize: scale(12) }]}
          >
            {formatTime(duration)}
          </Text>
          {timestampLabel ? (
            <Text
              variant="bodySmall"
              style={[styles.timestampText, { color: foregroundColor, fontSize: scale(12) }]}
            >
              {timestampLabel}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoBubble: {
    borderWidth: 1,
    borderRadius: 18,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    marginRight: 8,
    overflow: 'hidden',
  },
  logo: {
    width: 22,
    height: 22,
    resizeMode: 'contain',
  },
  playButton: {
    // Botão com aparência de "bolha" no player de áudio.
    borderWidth: 1,
    borderRadius: 18,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  content: {
    flex: 1,
    flexDirection: 'column',
    gap: 6,
  },
  waveformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  waveformBar: {
    width: 2.5,
    borderRadius: 1.25,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  durationText: {
    fontSize: 12,
    fontWeight: '600',
  },
  timestampText: {
    fontSize: 12,
    opacity: 0.75,
  },
});
