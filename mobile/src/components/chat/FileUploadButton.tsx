import React from 'react';
import { StyleSheet, TouchableOpacity, Platform, Alert } from 'react-native';
import { IconButton, useTheme } from 'react-native-paper';

export interface FileUploadResult {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  type: 'pdf' | 'image';
  base64?: string;
  blob?: Blob;
}

interface FileUploadButtonProps {
  onFileSelected: (file: FileUploadResult) => void;
  disabled?: boolean;
}

export function FileUploadButton({ onFileSelected, disabled = false }: FileUploadButtonProps) {
  const theme = useTheme();

  const handlePress = async () => {
    try {
      if (Platform.OS === 'web') {
        // Para web, criar input file nativo
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/pdf,image/jpeg,image/png,image/webp,image/gif';
        // iOS Safari requer que o input esteja no DOM (não display:none)
        input.style.position = 'fixed';
        input.style.top = '-9999px';
        input.style.left = '-9999px';
        input.style.opacity = '0';

        const cleanup = () => {
          try { document.body.removeChild(input); } catch {}
        };

        input.onchange = async (event: any) => {
          const file = event.target.files?.[0];
          cleanup();
          if (!file) return;

          // Verificar tamanho (20MB máximo)
          const maxSize = 20 * 1024 * 1024; // 20MB
          if (file.size > maxSize) {
            alert(`Arquivo muito grande. Tamanho máximo: 20MB`);
            return;
          }

          // Determinar tipo
          const isPDF = file.type === 'application/pdf';
          const isImage = file.type.startsWith('image/');

          if (!isPDF && !isImage) {
            alert('Tipo de arquivo não suportado. Apenas PDF e imagens são aceitos.');
            return;
          }

          // Ler base64 para envio ao agente
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result?.includes('base64,') ? result.split('base64,')[1] : '';

            onFileSelected({
              uri: URL.createObjectURL(file),
              name: file.name,
              mimeType: file.type,
              size: file.size,
              type: isPDF ? 'pdf' : 'image',
              base64,
              blob: file,
            });
          };
          reader.onerror = () => {
            alert('Erro ao ler o arquivo. Tente novamente.');
          };
          reader.readAsDataURL(file);
        };

        document.body.appendChild(input);
        input.click();
      } else {
        // Para mobile (iOS/Android), vamos usar um approach simples
        // Por enquanto, mostrar alerta informando que precisa implementar picker nativo
        Alert.alert(
          'Upload de Arquivo',
          'Funcionalidade de upload de arquivos no mobile está em desenvolvimento. Use a versão web para enviar exames.',
          [{ text: 'OK' }]
        );
      }
    } catch (error: any) {
      console.error('[FILE-UPLOAD] Erro ao selecionar arquivo:', error);
      if (Platform.OS === 'web') {
        alert('Erro ao selecionar arquivo. Tente novamente.');
      }
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled}
      activeOpacity={0.7}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <IconButton
        icon="paperclip"
        iconColor={theme.colors.primary}
        size={28}
        disabled={disabled}
        containerColor="transparent"
        style={styles.button}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    margin: 0,
  },
});
