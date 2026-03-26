import { ActionSheetIOS, Alert, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase/client';

export type NativeExamUploadIntent = 'any' | 'image' | 'pdf';

export interface NativeExamUploadAsset {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  fileType: 'image' | 'pdf';
}

export interface UploadedNativeExamFile {
  fileUrl: string;
  mimeType: string;
  fileName: string;
  fileType: 'image' | 'pdf';
  storageBucket: string | null;
  storagePath: string | null;
}

type NativeUploadChoice = 'library' | 'camera' | 'document' | null;

const sanitizeFileName = (value: string, fallback: string) => {
  const normalized = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  return normalized || fallback;
};

const guessFileNameFromUri = (uri: string, fallback: string) => {
  const raw = uri.split('/').pop() || fallback;
  return sanitizeFileName(raw, fallback);
};

const ensureFileSize = async (uri: string, size?: number | null) => {
  if (typeof size === 'number' && Number.isFinite(size) && size > 0) {
    return size;
  }

  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists && typeof info.size === 'number' && Number.isFinite(info.size)) {
    return info.size;
  }

  return 0;
};

const showNativeChoiceSheet = (intent: NativeExamUploadIntent): Promise<NativeUploadChoice> => {
  if (intent === 'pdf') {
    return Promise.resolve('document');
  }

  const choices =
    intent === 'image'
      ? [
          { label: 'Fototeca', value: 'library' as const },
          { label: 'Tirar Foto', value: 'camera' as const },
        ]
      : [
          { label: 'Fototeca', value: 'library' as const },
          { label: 'Tirar Foto', value: 'camera' as const },
          { label: 'Escolher Arquivo', value: 'document' as const },
          { label: 'Google Drive', value: 'document' as const },
        ];

  if (Platform.OS === 'ios') {
    return new Promise((resolve) => {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...choices.map((choice) => choice.label), 'Cancelar'],
          cancelButtonIndex: choices.length,
        },
        (selectedIndex) => {
          if (selectedIndex === choices.length) {
            resolve(null);
            return;
          }

          resolve(choices[selectedIndex]?.value ?? null);
        },
      );
    });
  }

  return new Promise((resolve) => {
    const androidChoices =
      intent === 'image'
        ? [
            { text: 'Fototeca', onPress: () => resolve('library' as const) },
            { text: 'Tirar Foto', onPress: () => resolve('camera' as const) },
          ]
        : [
            { text: 'Fototeca', onPress: () => resolve('library' as const) },
            { text: 'Escolher Arquivo', onPress: () => resolve('document' as const) },
          ];

    Alert.alert('Enviar resultado', 'Escolha como deseja enviar o exame.', [
      ...androidChoices,
      {
        text: 'Cancelar',
        style: 'cancel',
        onPress: () => resolve(null),
      },
    ]);
  });
};

const pickImageFromLibrary = async (): Promise<NativeExamUploadAsset | null> => {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Permissão de fotos não concedida.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 0.9,
  });

  if (result.canceled) {
    return null;
  }

  const asset = result.assets[0];
  const fileName = sanitizeFileName(
    asset.fileName || guessFileNameFromUri(asset.uri, `resultado_${Date.now()}.jpg`),
    `resultado_${Date.now()}.jpg`,
  );
  const mimeType = asset.mimeType || 'image/jpeg';

  return {
    uri: asset.uri,
    name: fileName,
    mimeType,
    size: await ensureFileSize(asset.uri, asset.fileSize),
    fileType: 'image',
  };
};

const pickImageFromCamera = async (): Promise<NativeExamUploadAsset | null> => {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Permissão da câmera não concedida.');
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 0.9,
  });

  if (result.canceled) {
    return null;
  }

  const asset = result.assets[0];
  const fileName = sanitizeFileName(
    asset.fileName || guessFileNameFromUri(asset.uri, `camera_${Date.now()}.jpg`),
    `camera_${Date.now()}.jpg`,
  );
  const mimeType = asset.mimeType || 'image/jpeg';

  return {
    uri: asset.uri,
    name: fileName,
    mimeType,
    size: await ensureFileSize(asset.uri, asset.fileSize),
    fileType: 'image',
  };
};

const pickDocument = async (intent: NativeExamUploadIntent): Promise<NativeExamUploadAsset | null> => {
  const type =
    intent === 'image'
      ? ['image/*']
      : intent === 'pdf'
        ? 'application/pdf'
        : ['image/*', 'application/pdf'];

  const result = await DocumentPicker.getDocumentAsync({
    type,
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.length) {
    return null;
  }

  const asset = result.assets[0];
  const fileName = sanitizeFileName(
    asset.name || guessFileNameFromUri(asset.uri, `arquivo_${Date.now()}`),
    `arquivo_${Date.now()}`,
  );
  const isPdf = asset.mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

  return {
    uri: asset.uri,
    name: fileName,
    mimeType: asset.mimeType || (isPdf ? 'application/pdf' : 'image/jpeg'),
    size: await ensureFileSize(asset.uri, asset.size),
    fileType: isPdf ? 'pdf' : 'image',
  };
};

export const pickNativeExamUploadAsset = async (
  intent: NativeExamUploadIntent,
): Promise<NativeExamUploadAsset | null> => {
  const choice = await showNativeChoiceSheet(intent);

  if (!choice) {
    return null;
  }

  if (choice === 'library') {
    return pickImageFromLibrary();
  }

  if (choice === 'camera') {
    return pickImageFromCamera();
  }

  return pickDocument(intent);
};

export const uploadNativeExamAsset = async (
  asset: NativeExamUploadAsset,
): Promise<UploadedNativeExamFile> => {
  const fileBase64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const { data, error } = await supabase.functions.invoke('upload-exame', {
    body: {
      file_base64: fileBase64,
      filename: asset.name,
      mime_type: asset.mimeType,
      file_size: asset.size,
    },
  });

  if (error) {
    throw new Error(error.message || 'Erro ao enviar arquivo');
  }

  if (!data?.file_url) {
    throw new Error('Upload falhou: URL não retornada');
  }

  return {
    fileUrl: data.file_url as string,
    mimeType: (data.mime_type as string) || asset.mimeType,
    fileName: asset.name,
    fileType: asset.fileType,
    storageBucket: (data.bucket as string) || null,
    storagePath: (data.storage_path as string) || null,
  };
};
