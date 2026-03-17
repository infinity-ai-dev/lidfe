import React from 'react';
import { View, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Avatar, Card, Text, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { formatTimeAgo } from '@/utils/helpers';
import { AudioMessagePlayer, type AudioPlayerControls } from './AudioMessagePlayer';
import type { ChatMessage } from '@/types';
import { useFontScale } from '@/hooks/useFontScale';

const ACAO_GUIAS_MARKER = '[[ACAO:guias_exames]]';

interface ChatMessageItemProps {
  message: ChatMessage;
  userAvatarUrl?: string | null;
  registerAudioPlayer?: (id: string, controls: AudioPlayerControls) => (() => void) | void;
  onAudioPlay?: (id: string) => void;
  onAudioPause?: (id: string) => void;
  onAudioEnd?: (id: string) => void;
}

export function ChatMessageItem({
  message,
  userAvatarUrl,
  registerAudioPlayer,
  onAudioPlay,
  onAudioPause,
  onAudioEnd,
}: ChatMessageItemProps) {
  const theme = useTheme();
  const { scale } = useFontScale();
  const router = useRouter();
  const isUser = message.role === 'user';

  const hasGuiasButton = !isUser && typeof message.message === 'string' && message.message.includes(ACAO_GUIAS_MARKER);
  const displayMessage = hasGuiasButton
    ? message.message.replace(ACAO_GUIAS_MARKER, '').trim()
    : message.message;
  const isAudio = message.type === 'audio';
  const isFile = message.type === 'file';
  const resolvedAvatarUrl = (userAvatarUrl || '').trim();
  const hasUserAvatar = resolvedAvatarUrl.length > 0;
  const isImageFile = isFile && (message.mime_type || '').startsWith('image/');
  const fileLabel = message.file_name || (message.file_type === 'pdf' ? 'Exame em PDF' : 'Exame anexado');
  const fileSizeLabel = typeof message.file_size === 'number'
    ? `${(message.file_size / 1024 / 1024).toFixed(1)} MB`
    : null;
  const imageUri = isImageFile && message.message
    ? `data:${message.mime_type || 'image/jpeg'};base64,${message.message}`
    : null;

  return (
    <View
      style={[
        styles.container,
        isUser ? styles.userContainer : styles.modelContainer,
      ]}
    >
      <View style={styles.messageRow}>
        <Card
          style={[
            styles.card,
            isAudio ? styles.audioCard : null,
            {
              backgroundColor: isUser
                ? theme.colors.primary
                : theme.colors.surfaceVariant,
            },
          ]}
        >
          <Card.Content style={isAudio ? styles.audioCardContent : styles.cardContent}>
            {isAudio ? (
              // Para balões de áudio, passamos contexto do remetente para cores corretas.
            <AudioMessagePlayer
              messageId={message.id}
              audioBase64={message.message}
              mimeType={message.mime_type}
              isUser={isUser}
              createdAt={message.created_at}
              registerControls={registerAudioPlayer}
              onPlayRequest={onAudioPlay}
              onPauseRequest={onAudioPause}
              onPlaybackEnd={onAudioEnd}
            />
          ) : isFile ? (
              <View style={styles.fileContainer}>
                <View style={styles.filePreview}>
                  {imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.fileImage} />
                  ) : (
                    <Avatar.Icon
                      size={44}
                      icon={message.file_type === 'pdf' ? 'file-pdf-box' : 'file-image'}
                      color={theme.colors.onSurfaceVariant}
                      style={{ backgroundColor: theme.colors.surfaceVariant }}
                    />
                  )}
                </View>
                <View style={styles.fileMeta}>
                  <Text
                    style={[
                      styles.fileTitle,
                      {
                        color: isUser
                          ? theme.colors.onPrimary
                          : theme.colors.onSurfaceVariant,
                        fontSize: scale(14),
                      },
                    ]}
                  >
                    {fileLabel}
                  </Text>
                  {fileSizeLabel && (
                    <Text
                      style={[
                        styles.fileSubtitle,
                        { color: theme.colors.onSurfaceVariant, fontSize: scale(11) },
                      ]}
                    >
                      {fileSizeLabel}
                    </Text>
                  )}
                  {message.mime_type && (
                    <Text
                      style={[
                        styles.fileSubtitle,
                        { color: theme.colors.onSurfaceVariant, fontSize: scale(11) },
                      ]}
                    >
                      {message.mime_type}
                    </Text>
                  )}
                </View>
              </View>
          ) : (
              <View>
                <Text
                  style={[
                    styles.text,
                    {
                      color: isUser
                        ? theme.colors.onPrimary
                        : theme.colors.onSurfaceVariant,
                      fontSize: scale(16),
                      lineHeight: scale(22),
                    },
                  ]}
                >
                  {displayMessage}
                </Text>
                {hasGuiasButton && (
                  <TouchableOpacity
                    style={[styles.guiasButton, { backgroundColor: theme.colors.primary }]}
                    onPress={() => router.push('/(tabs)/exames')}
                  >
                    <Text style={[styles.guiasButtonText, { color: theme.colors.onPrimary, fontSize: scale(14) }]}>
                      Ver Guias de Exames
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {message.created_at && (
              <Text
                style={[
                  styles.timestamp,
                  {
                    color: isUser
                      ? theme.colors.onPrimary
                      : theme.colors.onSurfaceVariant,
                    fontSize: scale(12),
                  },
                ]}
              >
                {formatTimeAgo(message.created_at)}
              </Text>
            )}
          </Card.Content>
        </Card>

        {isUser && (
          <View style={styles.avatarWrapper}>
            {hasUserAvatar ? (
              <Avatar.Image size={34} source={{ uri: resolvedAvatarUrl }} />
            ) : (
              <Avatar.Icon
                size={34}
                icon="account-circle"
                color={theme.colors.onPrimaryContainer}
                style={{ backgroundColor: theme.colors.primaryContainer }}
              />
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    marginHorizontal: 16,
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  modelContainer: {
    alignItems: 'flex-start',
  },
  card: {
    maxWidth: '80%',
    borderRadius: 24,
    overflow: 'hidden',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  avatarWrapper: {
    marginLeft: 8,
  },
  // Balão de áudio mais largo para acomodar waveform.
  audioCard: {
    maxWidth: '92%',
  },
  cardContent: {
    padding: 12,
  },
  // Balão de áudio usa padding mais horizontal para destacar waveform e controles.
  audioCardContent: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
  },
  fileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filePreview: {
    marginRight: 10,
  },
  fileImage: {
    width: 54,
    height: 54,
    borderRadius: 8,
  },
  fileMeta: {
    flexShrink: 1,
  },
  fileTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  fileSubtitle: {
    fontSize: 11,
    opacity: 0.85,
  },
  timestamp: {
    fontSize: 12,
    marginTop: 4,
    opacity: 0.7,
  },
  guiasButton: {
    marginTop: 12,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  guiasButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
