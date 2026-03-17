import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated, Platform } from 'react-native';
import { Icon, IconButton, Text, useTheme } from 'react-native-paper';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { useFontScale } from '@/hooks/useFontScale';

const WAVEFORM_BAR_COUNT = 30;
const WAVEFORM_SAMPLE_MS = 80;
const WAVEFORM_MIN_HEIGHT = 4;
const WAVEFORM_MAX_HEIGHT = 20;
const WAVEFORM_FLOOR_DB = -60;

const createInitialWaveform = () =>
  Array.from({ length: WAVEFORM_BAR_COUNT }, () => WAVEFORM_MIN_HEIGHT);

interface AudioRecorderButtonProps {
  onAudioRecorded: (audioBase64: string) => void;
  onRecordingStateChanged?: (isRecording: boolean) => void;
  onAudioDeleted?: () => void;
  disabled?: boolean;
  width?: number;
  height?: number;
  showPreview?: boolean; // Se true, mostra preview acima do input
}

export function AudioRecorderButton({
  onAudioRecorded,
  onRecordingStateChanged,
  onAudioDeleted,
  disabled = false,
  width = 60,
  height = 60,
  showPreview = false,
}: AudioRecorderButtonProps) {
  const theme = useTheme();
  const { scale } = useFontScale();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordedAudio, setRecordedAudio] = useState<{ base64: string; duration: number; mimeType: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [waveformBars, setWaveformBars] = useState<number[]>(() => createInitialWaveform());

  // Web recorder refs (MediaRecorder não existe no RN nativo)
  const mediaRecorderRef = useRef<any>(null);
  const mediaStreamRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const meteringIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserDataRef = useRef<Uint8Array | null>(null);
  const analyserSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const discardRecordingRef = useRef(false);
  const recordingSecondsRef = useRef(0);
  const lastRecordingSecondsRef = useRef(0);
  const waveformBarsRef = useRef<number[]>(waveformBars);
  const pendingSendRef = useRef(false);

  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      scaleAnim.setValue(1);
    }
  }, [isRecording, scaleAnim]);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  useEffect(() => {
    recordingSecondsRef.current = recordingSeconds;
  }, [recordingSeconds]);

  // Cleanup do áudio e stream quando componente desmontar
  useEffect(() => {
    return () => {
      if (sound) {
        if (Platform.OS === 'web') {
          const audio = sound as any;
          if (audio.pause) audio.pause();
          if (audio._lidfeRef) {
            URL.revokeObjectURL(audio._lidfeRef.src);
          }
        } else {
          sound.unloadAsync();
        }
      }
      // Liberar stream de microfone no unmount
      if (Platform.OS === 'web' && mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track: any) => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, [sound]);

  const resetWaveform = useCallback(() => {
    const next = createInitialWaveform();
    waveformBarsRef.current = next;
    setWaveformBars(next);
  }, []);

  const pushWaveformSample = useCallback((height: number) => {
    setWaveformBars((prev) => {
      const next = prev.length >= WAVEFORM_BAR_COUNT
        ? [...prev.slice(1), height]
        : [...prev, height];
      waveformBarsRef.current = next;
      return next;
    });
  }, []);

  const dbToHeight = useCallback((db?: number | null) => {
    if (typeof db !== 'number' || Number.isNaN(db)) {
      return WAVEFORM_MIN_HEIGHT;
    }
    const clamped = Math.max(WAVEFORM_FLOOR_DB, Math.min(0, db));
    const normalized = (clamped - WAVEFORM_FLOOR_DB) / (0 - WAVEFORM_FLOOR_DB);
    const eased = Math.pow(normalized, 1.4);
    return WAVEFORM_MIN_HEIGHT + eased * (WAVEFORM_MAX_HEIGHT - WAVEFORM_MIN_HEIGHT);
  }, []);

  const stopWebMetering = useCallback(() => {
    if (meteringIntervalRef.current) {
      clearInterval(meteringIntervalRef.current);
    }
    meteringIntervalRef.current = null;

    if (analyserSourceRef.current) {
      try {
        analyserSourceRef.current.disconnect();
      } catch {
        // noop
      }
    }
    analyserSourceRef.current = null;

    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        // noop
      }
    }
    analyserRef.current = null;
    analyserDataRef.current = null;

    if (audioContextRef.current) {
      try {
        void audioContextRef.current.close?.();
      } catch {
        // noop
      }
    }
    audioContextRef.current = null;
  }, []);

  const startWebMetering = useCallback(async (stream: MediaStream) => {
    stopWebMetering();

    const AudioContextCtor = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    const audioContext: AudioContext = new AudioContextCtor();
    audioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(stream);
    analyserSourceRef.current = source;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.fftSize);
    analyserDataRef.current = dataArray;

    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume?.();
      } catch {
        // noop
      }
    }

    meteringIntervalRef.current = setInterval(() => {
      const currentAnalyser = analyserRef.current;
      const currentData = analyserDataRef.current;
      if (!currentAnalyser || !currentData) return;

      currentAnalyser.getByteTimeDomainData(currentData);
      let sumSquares = 0;
      for (let i = 0; i < currentData.length; i += 1) {
        const value = (currentData[i] - 128) / 128;
        sumSquares += value * value;
      }
      const rms = Math.sqrt(sumSquares / currentData.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -160;
      pushWaveformSample(dbToHeight(db));
    }, WAVEFORM_SAMPLE_MS);
  }, [dbToHeight, pushWaveformSample, stopWebMetering]);

  useEffect(() => {
    return () => {
      stopWebMetering();
    };
  }, [stopWebMetering]);

  const cleanupSound = useCallback(async () => {
    if (!sound) return;
    if (Platform.OS === 'web') {
      const audio = sound as any;
      audio.pause?.();
    } else {
      await sound.unloadAsync();
    }
    setSound(null);
  }, [sound]);

  /**
   * Normaliza áudio base64 para formato padronizado (base64 puro, sem prefixo)
   * CRÍTICO: Garante que todos os áudios sejam salvos no mesmo formato
   */
  const normalizeAudioBase64 = (audioData: string): string => {
    if (!audioData || audioData.length === 0) {
      throw new Error('Áudio base64 vazio');
    }

    // Remover qualquer prefixo data: se existir (data:audio/wav;base64, ou data:audio/webm;base64, etc)
    let cleanBase64 = audioData.replace(/^data:audio\/[^;]+;base64,/, '');
    
    // Se ainda tiver prefixo data: sem base64, remover também
    cleanBase64 = cleanBase64.replace(/^data:audio\/[^,]+,\s*/, '');

    // Remover espaços e quebras de linha (normalizar base64)
    cleanBase64 = cleanBase64.replace(/\s+/g, '');

    // Validar que é base64 válido
    const base64Pattern = /^[A-Za-z0-9+/=]+$/;
    if (!base64Pattern.test(cleanBase64)) {
      console.warn('[RECORDER] ⚠️ Áudio contém caracteres inválidos após normalização');
      // Tentar extrair apenas a parte válida (últimos caracteres antes de caracteres inválidos)
      const match = cleanBase64.match(/^([A-Za-z0-9+/=]+)/);
      if (match) {
        cleanBase64 = match[1];
      } else {
        throw new Error('Áudio base64 contém caracteres inválidos');
      }
    }

    // Validar tamanho mínimo
    if (cleanBase64.length < 100) {
      throw new Error('Áudio base64 muito pequeno (provavelmente inválido)');
    }

    return cleanBase64;
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        try {
          // Normalizar base64 removendo prefixo
          const cleanBase64 = normalizeAudioBase64(dataUrl);
          resolve(cleanBase64);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Erro ao ler áudio'));
      reader.readAsDataURL(blob);
    });

  const startRecording = async () => {
    try {
      setIsProcessing(true);
      resetWaveform();
      discardRecordingRef.current = false;
      lastRecordingSecondsRef.current = 0;

      if (Platform.OS === 'web') {
        // Web: usar MediaRecorder para capturar áudio
        if (!navigator.mediaDevices?.getUserMedia) {
          console.error('[RECORDER] getUserMedia não suportado no navegador');
          setIsProcessing(false);
          return;
        }

        // Reutilizar stream existente se disponível (evita re-pedir permissão no iOS Safari)
        let stream = mediaStreamRef.current;
        if (!stream || stream.getTracks().every((t: any) => t.readyState === 'ended')) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaStreamRef.current = stream;
        }
        await startWebMetering(stream);
        const preferredTypes = [
          'audio/mp4;codecs=mp4a.40.2',
          'audio/mp4',
          'audio/mpeg',
          'audio/webm;codecs=opus',
          'audio/webm',
        ];
        const supportedType = preferredTypes.find((type) =>
          typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)
        );
        const recorder = supportedType
          ? new MediaRecorder(stream, { mimeType: supportedType })
          : new MediaRecorder(stream);

        audioChunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        recorder.onstop = async () => {
          const shouldDiscard = discardRecordingRef.current;
          discardRecordingRef.current = false;
          try {
            const chunks = audioChunksRef.current;
            audioChunksRef.current = [];

            if (shouldDiscard) {
              return;
            }
            const blob = new Blob(chunks, {
              type: recorder.mimeType || 'audio/webm',
            });
            // blobToBase64 já normaliza (remove prefixo)
            const cleanBase64 = await blobToBase64(blob);
            const mimeType = recorder.mimeType || supportedType || 'audio/webm';
            
            // Armazenar áudio gravado para preview (já normalizado)
            setRecordedAudio({
              base64: cleanBase64,
              duration: lastRecordingSecondsRef.current || recordingSecondsRef.current,
              mimeType: mimeType,
            });
          } catch (error) {
            console.error('[RECORDER] Erro ao processar áudio no web:', error);
          } finally {
            setIsProcessing(false);
          }
        };

        mediaRecorderRef.current = recorder;
        recorder.start();

        setIsRecording(true);
        onRecordingStateChanged?.(true);
        setIsProcessing(false);
        return;
      }

      // Mobile (Expo AV)
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        console.error('[RECORDER] Permissão de microfone negada');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
          isMeteringEnabled: true,
        },
        (status) => {
          if (!status.isRecording) return;
          pushWaveformSample(dbToHeight(status.metering));
        },
        WAVEFORM_SAMPLE_MS
      );

      setRecording(newRecording);
      setIsRecording(true);
      onRecordingStateChanged?.(true);
    } catch (error) {
      console.error('[RECORDER] Erro ao iniciar gravação:', error);
      setIsProcessing(false);
      stopWebMetering();
    } finally {
      setIsProcessing(false);
    }
  };

  const stopRecording = async () => {
    if (Platform.OS === 'web') {
      // Web: parar MediaRecorder
      const recorder = mediaRecorderRef.current;
      if (!recorder) return;

      try {
        setIsProcessing(true);
        lastRecordingSecondsRef.current = recordingSecondsRef.current;
        setIsRecording(false);
        onRecordingStateChanged?.(false);
        discardRecordingRef.current = false;
        stopWebMetering();

        if (recorder.state !== 'inactive') {
          recorder.stop();
        }

        // NÃO encerrar o stream aqui - manter vivo para reutilizar
        // No iOS Safari, parar os tracks revoga a permissão de microfone
      } catch (error) {
        console.error('[RECORDER] Erro ao parar gravação no web:', error);
        setIsProcessing(false);
      } finally {
        mediaRecorderRef.current = null;
      }
      return;
    }

    if (!recording) return;

    try {
      setIsProcessing(true);
      setIsRecording(false);
      onRecordingStateChanged?.(false);

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();

      if (uri) {
        // Obter status para pegar duração
        const status = await recording.getStatusAsync();
        const duration = status.durationMillis ? Math.floor(status.durationMillis / 1000) : recordingSeconds;
        
        // Ler arquivo e converter para base64 (FileSystem já retorna base64 puro)
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        // CRÍTICO: Normalizar base64 para garantir formato padronizado
        // Mesmo que FileSystem retorne base64 puro, normalizar para garantir consistência
        const cleanBase64 = normalizeAudioBase64(base64);

        // Armazenar áudio gravado para preview (já normalizado)
        setRecordedAudio({
          base64: cleanBase64,
          duration: duration,
          mimeType: 'audio/m4a', // Expo AV grava em m4a por padrão
        });
      }

      setRecording(null);
    } catch (error) {
      console.error('[RECORDER] Erro ao parar gravação:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const cancelRecording = useCallback(async () => {
    if (!isRecording) return;

    try {
      setIsProcessing(true);
      setIsRecording(false);
      onRecordingStateChanged?.(false);

      if (Platform.OS === 'web') {
        discardRecordingRef.current = true;
        stopWebMetering();

        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
          recorder.stop();
        }

        // NÃO encerrar o stream - manter vivo para reutilizar
        mediaRecorderRef.current = null;
        audioChunksRef.current = [];
        return;
      }

      if (recording) {
        try {
          await recording.stopAndUnloadAsync();
        } catch (error) {
          console.warn('[RECORDER] Cancelamento ignorado:', error);
        }
        setRecording(null);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [isRecording, onRecordingStateChanged, recording, stopWebMetering]);

  const handlePress = () => {
    if (isProcessing || disabled) return;
    if (isRecording) {
      void stopRecording();
    } else {
      void startRecording();
    }
  };

  const handleDelete = () => {
    if (isRecording) {
      void cancelRecording();
    }
    setRecordedAudio(null);
    setRecordingSeconds(0);
    setPlaybackPosition(0);
    resetWaveform();
    void cleanupSound();
    setIsPlaying(false);
    onAudioDeleted?.();
  };

  const handleSend = () => {
    if (isRecording) {
      // Parar gravação e auto-enviar quando o áudio estiver pronto
      pendingSendRef.current = true;
      void stopRecording();
      return;
    }
    if (recordedAudio) {
      onAudioRecorded(recordedAudio.base64);
      setRecordedAudio(null);
      setRecordingSeconds(0);
      setPlaybackPosition(0);
      resetWaveform();
      void cleanupSound();
      setIsPlaying(false);
    }
  };

  // Auto-enviar quando o áudio ficar pronto após stopRecording acionado pelo botão enviar
  useEffect(() => {
    if (recordedAudio && pendingSendRef.current) {
      pendingSendRef.current = false;
      onAudioRecorded(recordedAudio.base64);
      setRecordedAudio(null);
      setRecordingSeconds(0);
      setPlaybackPosition(0);
      resetWaveform();
      void cleanupSound();
      setIsPlaying(false);
    }
  }, [recordedAudio]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlayPause = async () => {
    if (!recordedAudio) return;

    try {
      if (Platform.OS === 'web') {
        if (sound && isPlaying) {
          // Pausar
          const audio = sound as any;
          audio.pause();
          setIsPlaying(false);
        } else if (sound && !isPlaying) {
          // Retomar
          const audio = sound as any;
          await audio.play();
          setIsPlaying(true);
        } else {
          // Criar e tocar
          const audioBlob = new Blob([
            Uint8Array.from(atob(recordedAudio.base64), c => c.charCodeAt(0))
          ], { type: recordedAudio.mimeType });
          const audioUrl = URL.createObjectURL(audioBlob);
          // IMPORTANTE: usar globalThis.Audio (HTMLAudioElement) e não o Audio do expo-av
          const AudioCtor = (globalThis as any).Audio;
          const audio = new AudioCtor(audioUrl) as HTMLAudioElement;
          
          audio.onended = () => {
            setIsPlaying(false);
            setPlaybackPosition(0);
            URL.revokeObjectURL(audioUrl);
          };
          
          audio.onloadedmetadata = () => {
            setPlaybackPosition(0);
          };
          
          audio.ontimeupdate = () => {
            setPlaybackPosition(Math.floor(audio.currentTime));
          };
          
          await audio.play();
          setIsPlaying(true);
          
          // Armazenar referência
          setSound(audio as any);
        }
      } else {
        // Mobile: usar Expo AV
        if (sound && isPlaying) {
          // Pausar
          await sound.pauseAsync();
          setIsPlaying(false);
        } else if (sound && !isPlaying) {
          // Retomar
          await sound.playAsync();
          setIsPlaying(true);
        } else {
          // Criar e tocar
          const { sound: newSound } = await Audio.Sound.createAsync(
            { uri: `data:${recordedAudio.mimeType};base64,${recordedAudio.base64}` },
            { shouldPlay: true }
          );
          
          newSound.setOnPlaybackStatusUpdate((status) => {
            if (status.isLoaded) {
              setPlaybackPosition(Math.floor(status.positionMillis / 1000));
              if (status.didJustFinish) {
                setIsPlaying(false);
                setPlaybackPosition(0);
              }
            }
          });
          
          setSound(newSound);
          setIsPlaying(true);
        }
      }
    } catch (error) {
      console.error('[RECORDER] Erro ao tocar áudio:', error);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const shouldShowPreview = showPreview || isRecording || Boolean(recordedAudio);

  // Se há gravação/áudio gravado, mostrar preview estilo WhatsApp
  if (shouldShowPreview) {
    const waveformCount = waveformBars.length;
    const safeDuration = recordedAudio?.duration ?? 0;
    const progressRatio = safeDuration > 0 ? Math.min(1, Math.max(0, playbackPosition / safeDuration)) : 0;
    const progressIndex = Math.round(progressRatio * Math.max(0, waveformCount - 1));
    const displaySeconds = isRecording
      ? recordingSeconds
      : (isPlaying ? playbackPosition : safeDuration);

    return (
      <View style={styles.previewContainer}>
        <View style={[styles.previewCard, { backgroundColor: theme.colors.surfaceVariant }]}>
          {/* Botão de excluir (lixeira) */}
          <TouchableOpacity
            onPress={handleDelete}
            style={styles.deleteButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon
              source="delete-outline"
              color={theme.colors.onSurface}
              size={22}
            />
          </TouchableOpacity>

          {/* Waveform e controles */}
          <View style={styles.previewContent}>
            {/* Botão de play/pause (círculo vermelho com pause ou play) */}
            <TouchableOpacity
              onPress={isRecording ? () => void stopRecording() : handlePlayPause}
              style={[styles.playButton, { backgroundColor: theme.colors.error }]}
            >
              <Icon
                source={isRecording ? 'pause' : (isPlaying ? 'pause' : 'play')}
                color={theme.colors.onError}
                size={18}
              />
            </TouchableOpacity>

            <View style={styles.waveformContainer}>
              {/* Waveform em tempo real */}
              <View style={styles.waveform}>
                {waveformBars.map((height, i) => {
                  const isActive = isRecording
                    ? i >= waveformCount - 3
                    : (isPlaying && i <= progressIndex);
                  return (
                    <View
                      key={`wave-${i}`}
                      style={[
                        styles.waveformBar,
                        {
                          height: height,
                          backgroundColor: isActive 
                            ? theme.colors.primary 
                            : theme.colors.onSurfaceVariant,
                          opacity: isActive ? 0.9 : 0.5,
                        },
                      ]}
                    />
                  );
                })}
              </View>
              <Text style={[styles.duration, { color: theme.colors.onSurface, fontSize: scale(12) }]}>
                {formatTime(displaySeconds)}
              </Text>
            </View>

            {/* Botão de enviar (círculo verde com avião) */}
            <TouchableOpacity
              onPress={handleSend}
              style={[
                styles.sendButton,
                { backgroundColor: theme.colors.primary },
              ]}
            >
              <Icon
                source="send"
                color={theme.colors.onPrimary}
                size={18}
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // Estado normal: botão de gravação
  return (
    <View style={styles.container}>
      <TouchableOpacity
        onPress={handlePress}
        disabled={isProcessing || disabled}
        activeOpacity={0.7}
      >
        <Animated.View
          style={[
            styles.button,
            {
              width,
              height,
              backgroundColor: isRecording
                ? theme.colors.error
                : theme.colors.primary,
              transform: [{ scale: scaleAnim }],
              opacity: disabled ? 0.5 : 1,
            },
          ]}
        >
          <IconButton
            icon={isRecording ? 'stop' : 'microphone'}
            iconColor={theme.colors.onPrimary}
            size={24}
            disabled={isProcessing || disabled}
            containerColor="transparent"
            style={{ backgroundColor: 'transparent' }}
          />
        </Animated.View>
      </TouchableOpacity>
      {isRecording && (
        <Text
          variant="bodySmall"
          style={[styles.timer, { color: theme.colors.onSurfaceVariant, fontSize: scale(12) }]}
        >
          {formatTime(recordingSeconds)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timer: {
    marginTop: 8,
    fontSize: 12,
  },
  previewContainer: {
    width: '100%',
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    paddingHorizontal: 12,
    borderRadius: 24,
    minHeight: 56,
  },
  deleteButton: {
    marginRight: 8,
  },
  previewContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  waveformContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    height: 28,
    maxHeight: 28,
  },
  waveformBar: {
    width: 2.5,
    borderRadius: 1.25,
    minHeight: 4,
    maxHeight: 20,
  },
  duration: {
    fontSize: 12,
    fontWeight: '500',
    minWidth: 32,
    textAlign: 'right',
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
