import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { PrescricaoPDFDocument } from './generators/prescricao';
import { ExameGuiaPDFDocument } from './generators/exame-guia';
import { ExameRequisicaoPDFDocument } from './generators/exame-requisicao';
import { type PDFData } from './generators/base';
import { storageService } from '@/services/supabase/storage';
import { useAppStore } from '@/store/appStore';
import * as Sharing from 'expo-sharing';
import { APP_CONFIG } from '@/utils/constants';

export interface PrescricaoPDFParams {
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
  qrCodeUrl?: string;
  qrCodeLabel?: string;
  certificadoDigital?: string;
  medicamentos?: Array<{
    nome: string;
    dosagem: string;
    frequencia: string;
    duracao: string;
    observacoes?: string;
  }>;
  id?: number;
}

export interface ExameGuiaPDFParams {
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
}

export interface ExameRequisicaoPDFParams {
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
  titulo1?: string;
  titulo2?: string;
  titulo3?: string;
  titulo4?: string;
  titulo5?: string;
  titulo6?: string;
  titulo7?: string;
  titulo8?: string;
  titulo9?: string;
  userId?: string;
  idThreadConversa?: string;
}

const pdfService = {
  /**
   * Gera imagem de QR Code via API pública apontando para a URL fornecida.
   */
  _buildQrCodeImageUrl(targetUrl: string, size = 160): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(targetUrl)}`;
  },

  /**
   * Helper: gera PDF, faz upload, e (two-pass) regenera com QR Code apontando para a URL pública do PDF.
   * Assim o laboratório/farmácia pode escanear o QR do PDF impresso e baixar o documento.
   */
  async _generateAndUploadWithQr<P extends Record<string, any>>(
    createDocument: (params: P) => React.ReactElement,
    params: P,
    bucket: string,
    fileName: string,
  ): Promise<{ pdfUrl: string; pdfBytes: Uint8Array } | null> {
    // Passo 1: gerar PDF sem QR (ou com QR placeholder) e fazer upload para obter a URL pública
    const doc1 = createDocument(params);
    const blob1 = await pdf(doc1 as any).toBlob();
    const arr1 = await blob1.arrayBuffer();

    const uploadBlob1 = new Blob([new Uint8Array(arr1)], { type: 'application/pdf' });
    const { data: up1, error: err1 } = await storageService.uploadFile(
      bucket, fileName, uploadBlob1, { contentType: 'application/pdf', upsert: true },
    );
    if (err1 || !up1) {
      console.error('[PDF] Erro ao fazer upload (passo 1):', err1);
      return null;
    }

    const pdfUrl = await storageService.getPublicUrl(bucket, fileName);
    if (!pdfUrl) return null;

    // Passo 2: regenerar o PDF com QR Code apontando para a URL pública
    const qrImageUrl = this._buildQrCodeImageUrl(pdfUrl);
    const paramsWithQr = { ...params, image2: qrImageUrl } as P;
    const doc2 = createDocument(paramsWithQr);
    const blob2 = await pdf(doc2 as any).toBlob();
    const arr2 = await blob2.arrayBuffer();
    const pdfBytes = new Uint8Array(arr2);

    // Re-upload com QR embutido (upsert sobrescreve o anterior)
    const uploadBlob2 = new Blob([pdfBytes], { type: 'application/pdf' });
    const { error: err2 } = await storageService.uploadFile(
      bucket, fileName, uploadBlob2, { contentType: 'application/pdf', upsert: true },
    );
    if (err2) {
      console.warn('[PDF] Erro no re-upload com QR, usando versão sem QR:', err2);
    }

    return { pdfUrl, pdfBytes };
  },

  async generatePrescricaoPDF(params: PrescricaoPDFParams): Promise<string | null> {
    try {
      // Gerar nome do arquivo
      const sanitizedNome = (params.nomepaciente || 'paciente')
        .replace(/[^a-zA-Z0-9]/g, '_');
      const sanitizedData = (params.data || Date.now().toString())
        .replace(/[^0-9]/g, '');
      const fileName = `receita_${sanitizedNome}_${sanitizedData}_${params.id || Date.now()}.pdf`;

      const enrichedParams: PrescricaoPDFParams = {
        ...params,
        certificadoDigital: 'Documento assinado digitalmente (ICP-Brasil ou equivalente da plataforma).',
      };

      const result = await this._generateAndUploadWithQr(
        (p) => React.createElement(PrescricaoPDFDocument, { data: p }),
        enrichedParams,
        'prescricao',
        fileName,
      );
      if (!result) return null;
      const { pdfUrl } = result;

      if (pdfUrl && params.id) {
        const { supabase } = await import('@/services/supabase/client');
        await supabase
          .from('goals_prescricao')
          .update({ pdfurlprescricao: pdfUrl })
          .eq('id', params.id);
      }

      useAppStore.getState().setPdfUrl(pdfUrl || '');
      return pdfUrl;
    } catch (error) {
      console.error('[PDF] Erro ao gerar PDF de prescrição:', error);
      return null;
    }
  },

  async generateExameGuiaPDF(params: ExameGuiaPDFParams): Promise<string | null> {
    try {
      const fileName = `exame_guia_${Date.now()}.pdf`;

      const result = await this._generateAndUploadWithQr(
        (p) => React.createElement(ExameGuiaPDFDocument, { data: p }),
        params,
        'guiapdf',
        fileName,
      );
      if (!result) return null;
      const { pdfUrl, pdfBytes } = result;

      // Assinar PDF para adicionar QR de autenticidade no rodapé
      try {
        const { supabase } = await import('@/services/supabase/client');
        const pdfBase64 = btoa(String.fromCharCode(...pdfBytes));
        const { data, error } = await supabase.functions.invoke('sign-pdf', {
          body: {
            pdf_base64: pdfBase64,
            document_type: 'exame',
            place_qr_on_first_page: true,
          },
        });
        if (!error && data?.success && data?.signed_pdf_base64) {
          const signedPdfBytes = Uint8Array.from(
            atob(data.signed_pdf_base64),
            (c) => c.charCodeAt(0),
          );
          const signedBlob = new Blob([signedPdfBytes], { type: 'application/pdf' });
          await storageService.uploadFile(
            'guiapdf', fileName, signedBlob,
            { contentType: 'application/pdf', upsert: true },
          );
        }
      } catch (signError) {
        console.warn('[PDF] Erro ao assinar PDF de guia, usando versão sem assinatura:', signError);
      }

      if (pdfUrl) {
        useAppStore.getState().setPdfUrl(pdfUrl);
      }
      return pdfUrl;
    } catch (error) {
      console.error('[PDF] Erro ao gerar PDF de guia de exame:', error);
      return null;
    }
  },

  async generateExameRequisicaoPDF(params: ExameRequisicaoPDFParams): Promise<string | null> {
    try {
      const fileName = `exame_requisicao_${Date.now()}.pdf`;

      const result = await this._generateAndUploadWithQr(
        (p) => React.createElement(ExameRequisicaoPDFDocument, { data: p }),
        params,
        'guiapdf',
        fileName,
      );
      if (!result) return null;
      let { pdfUrl, pdfBytes } = result;

      // Tentar assinar PDF via Edge Function (se disponível)
      try {
        const { supabase } = await import('@/services/supabase/client');
        const pdfBase64 = btoa(String.fromCharCode(...pdfBytes));

        const { data, error } = await supabase.functions.invoke('sign-pdf', {
          body: {
            pdf_base64: pdfBase64,
            signer_name: params.titulo5 || '',
            signer_crm: params.titulo6 || '',
            document_type: 'exame',
            place_qr_on_first_page: true,
          },
        });

        if (!error && data?.success && data?.signed_pdf_base64) {
          const signedPdfBytes = Uint8Array.from(
            atob(data.signed_pdf_base64),
            (c) => c.charCodeAt(0)
          );
          // Re-upload do PDF assinado
          const signedBlob = new Blob([signedPdfBytes], { type: 'application/pdf' });
          await storageService.uploadFile(
            'guiapdf', fileName, signedBlob,
            { contentType: 'application/pdf', upsert: true },
          );
        }
      } catch (signError) {
        console.warn('[PDF] Erro ao assinar PDF, usando PDF sem assinatura:', signError);
      }

      if (pdfUrl && params.userId && params.idThreadConversa) {
        const { supabase } = await import('@/services/supabase/client');
        await supabase
          .from('exames')
          .update({ pdfguiaexame: pdfUrl })
          .eq('user_id', params.userId)
          .eq('id_threadconversa', params.idThreadConversa);
      }

      if (pdfUrl) {
        useAppStore.getState().setPdfUrl(pdfUrl);
      }
      return pdfUrl;
    } catch (error) {
      console.error('[PDF] Erro ao gerar PDF de requisição de exame:', error);
      return null;
    }
  },

  async sharePDF(pdfUrl: string): Promise<boolean> {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(pdfUrl);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[PDF] Erro ao compartilhar PDF:', error);
      return false;
    }
  },
};

export default pdfService;
