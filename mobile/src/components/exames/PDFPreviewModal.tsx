import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Platform, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Text, Button, useTheme, Portal, Dialog, Modal } from 'react-native-paper';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Linking from 'expo-linking';
import { APP_CONFIG } from '@/utils/constants';

interface PDFPreviewModalProps {
  visible: boolean;
  onDismiss: () => void;
  pdfUrl: string;
  title?: string;
}

export function PDFPreviewModal({ visible, onDismiss, pdfUrl, title }: PDFPreviewModalProps) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerKey, setViewerKey] = useState(0);

  useEffect(() => {
    if (!visible || !pdfUrl) {
      setLoading(true);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setViewerKey((current) => current + 1);
  }, [visible, pdfUrl]);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      setError(null);

      if (Platform.OS === 'web') {
        const link = window.document.createElement('a');
        link.href = pdfUrl;
        link.download = `${(title || 'guia_exame').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
        link.target = '_blank';
        window.document.body.appendChild(link);
        link.click();
        window.document.body.removeChild(link);
        return;
      }

      // Baixar o PDF
      const fileUri = `${FileSystem.documentDirectory}guia_exame_${Date.now()}.pdf`;
      const downloadResult = await FileSystem.downloadAsync(pdfUrl, fileUri);

      if (downloadResult.status === 200) {
        // Verificar se o dispositivo suporta compartilhamento
        const isAvailable = await Sharing.isAvailableAsync();
        
        if (isAvailable) {
          await Sharing.shareAsync(downloadResult.uri, {
            mimeType: 'application/pdf',
            dialogTitle: 'Baixar Guia de Exame',
          });
        } else {
          // Fallback: abrir o PDF no navegador
          await Linking.openURL(pdfUrl);
        }
      } else {
        throw new Error('Erro ao baixar o PDF');
      }
    } catch (err: any) {
      console.error('[PDFPreview] Erro ao baixar PDF:', err);
      setError(err.message || 'Erro ao baixar o PDF');
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenExternal = async () => {
    try {
      if (Platform.OS === 'web') {
        window.open(pdfUrl, '_blank', 'noopener,noreferrer');
        return;
      }

      const supported = await Linking.canOpenURL(pdfUrl);
      if (supported) {
        await Linking.openURL(pdfUrl);
      } else {
        setError('Não foi possível abrir o PDF');
      }
    } catch (err: any) {
      console.error('[PDFPreview] Erro ao abrir PDF externamente:', err);
      setError(err.message || 'Erro ao abrir o PDF');
    }
  };

  const handleShareWhatsapp = async () => {
    try {
      setDownloading(true);
      setError(null);

      // Compartilhar via WhatsApp usando link direto para o PDF
      const whatsappNumber = APP_CONFIG.LAB_WHATSAPP_NUMBER;
      const message = `Segue o PDF para pré-cadastro: ${pdfUrl}`;
      if (whatsappNumber) {
        const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
        await Linking.openURL(whatsappUrl);
        return;
      }

      // Fallback: compartilhar pelo sistema caso o número não esteja configurado
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(pdfUrl, {
          mimeType: 'application/pdf',
          dialogTitle: 'Compartilhar PDF',
        });
        return;
      }

      await Linking.openURL(pdfUrl);
    } catch (err: any) {
      console.error('[PDFPreview] Erro ao compartilhar via WhatsApp:', err);
      setError(err.message || 'Erro ao compartilhar o PDF');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        dismissable={!downloading}
        style={styles.modalWrapper}
        contentContainerStyle={[
          styles.modalContainer,
          { backgroundColor: theme.colors.surface },
          { width: Math.min(width * 0.95, 1280), height: Math.min(height * 0.9, 960) },
        ]}
      >
        <View style={styles.header}>
          <Text variant="titleLarge" style={styles.title}>
            {title || 'Guia de Exame'}
          </Text>
          <Button onPress={onDismiss} mode="text">
            Fechar
          </Button>
        </View>

        {error && (
          <Dialog visible={!!error} onDismiss={() => setError(null)}>
            <Dialog.Title>Erro</Dialog.Title>
            <Dialog.Content>
              <Text>{error}</Text>
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setError(null)}>OK</Button>
            </Dialog.Actions>
          </Dialog>
        )}

        <View style={styles.content}>
          {visible && pdfUrl ? (
            Platform.OS === 'web' ? (
              <iframe
                key={`${viewerKey}-${pdfUrl}`}
                src={pdfUrl}
                title={title || 'Pré-visualização da guia'}
                style={{ width: '100%', height: '100%', border: 'none' }}
                onLoad={() => setLoading(false)}
              />
            ) : (
              <WebView
                key={`${viewerKey}-${pdfUrl}`}
                source={{ uri: pdfUrl }}
                style={styles.webview}
                onLoadEnd={() => setLoading(false)}
                onError={(syntheticEvent) => {
                  const { nativeEvent } = syntheticEvent;
                  console.error('[PDFPreview] Erro ao carregar WebView:', nativeEvent);
                  setError('Erro ao carregar o PDF');
                  setLoading(false);
                }}
              />
            )
          ) : null}

          {loading && visible && pdfUrl && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" />
              <Text style={styles.loadingText}>Carregando PDF...</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Button
            mode="outlined"
            icon="download"
            onPress={handleDownload}
            loading={downloading}
            disabled={downloading}
            style={styles.button}
          >
            {downloading ? 'Baixando...' : 'Baixar PDF'}
          </Button>
          <Button
            mode="contained"
            icon="whatsapp"
            onPress={handleShareWhatsapp}
            disabled={downloading}
            style={styles.button}
          >
            Compartilhar PDF
          </Button>
          <Button
            mode="contained"
            icon="open-in-new"
            onPress={handleOpenExternal}
            style={styles.button}
          >
            Abrir em Nova Aba
          </Button>
        </View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modalWrapper: {
    paddingHorizontal: 12,
    paddingVertical: 20,
  },
  modalContainer: {
    alignSelf: 'center',
    borderRadius: 12,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    flex: 1,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 16,
  },
  webview: {
    flex: 1,
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  loadingText: {
    marginTop: 8,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  button: {
    flexGrow: 1,
    minWidth: 140,
  },
});
