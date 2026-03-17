import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { storageService } from '@/services/supabase/storage';

// Registrar fontes (se necessário)
Font.register({
  family: 'Times-Roman',
  src: 'https://fonts.gstatic.com/s/timesnewroman/v1/times-new-roman.ttf',
});

export const pdfStyles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 12,
    fontFamily: 'Times-Roman',
  },
  header: {
    fontSize: 30,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  title: {
    fontSize: 20,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    marginBottom: 10,
  },
  body: {
    fontSize: 14,
    marginBottom: 10,
    lineHeight: 1.5,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    marginVertical: 10,
  },
  footer: {
    fontSize: 9,
    marginTop: 20,
    textAlign: 'left',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  column: {
    flexDirection: 'column',
  },
  image: {
    width: 150,
    height: 100,
    marginBottom: 10,
  },
});

export interface PDFData {
  titulo?: string;
  nomepaciente?: string;
  descricao?: string;
  data?: string;
  header2?: string;
  image1?: string;
  image2?: string;
  rodape1?: string;
  rodape2?: string;
  rodape3?: string;
  rodape4?: string;
  [key: string]: string | number | undefined;
}

export async function generatePDF(
  document: React.ReactElement,
  fileName: string
): Promise<Uint8Array> {
  // Esta função não é mais necessária - o pdf-service.ts usa renderToBuffer diretamente
  // Mantida apenas para compatibilidade
  return new Uint8Array(0);
}

export async function saveAndSharePDF(
  pdfBytes: Uint8Array,
  fileName: string
): Promise<string | null> {
  try {
    const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.writeAsStringAsync(fileUri, btoa(String.fromCharCode(...pdfBytes)), {
      encoding: FileSystem.EncodingType.Base64,
    });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri);
    }

    return fileUri;
  } catch (error) {
    console.error('[PDF] Erro ao salvar/compartilhar PDF:', error);
    return null;
  }
}

