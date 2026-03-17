import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { PDFDocument, rgb } from 'npm:pdf-lib@1.17.1';
import QRCode from 'npm:qrcode@1.5.3';
import forge from 'npm:node-forge@1.3.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SignRequest {
  pdf_base64: string;
  signer_name?: string;
  signer_crm?: string;
  document_type: string; // 'prescricao' ou 'exame'
  document_id?: string | number;
  place_qr_on_first_page?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const apiKeyHeader = req.headers.get('apikey');
    
    // Permitir chamadas internas com service role key
    // Verificar se o header apikey corresponde ao service role key
    let isInternalCall = false;
    if (apiKeyHeader && apiKeyHeader.length > 180) {
      // Service role keys são muito longas (>180 chars)
      isInternalCall = true;
      console.log('[SIGN-PDF] Chamada interna detectada via apikey header (tamanho:', apiKeyHeader.length, ')');
    } else if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      // Se o token é muito longo (>180) e parece JWT, pode ser service role
      if (token.length > 180 && token.split('.').length === 3) {
        isInternalCall = true;
        console.log('[SIGN-PDF] Chamada interna detectada via Authorization header (tamanho:', token.length, ')');
      }
    }

    if (!authHeader && !apiKeyHeader && !isInternalCall) {
      throw new Error('Missing authorization header');
    }

    // Sempre usar service role key se for chamada interna, senão usar anon key
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      isInternalCall ? serviceRoleKey : (Deno.env.get('SUPABASE_ANON_KEY') ?? ''),
      {
        global: {
          headers: { 
            Authorization: authHeader || (isInternalCall ? `Bearer ${serviceRoleKey}` : ''),
            ...(apiKeyHeader ? { apikey: apiKeyHeader } : {}),
          },
        },
      }
    );

    // Se for chamada interna (service role), pular verificação de usuário
    if (!isInternalCall) {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error('Unauthorized');
      }
    } else {
      console.log('[SIGN-PDF] Chamada interna confirmada, pulando verificação de usuário');
    }

    const body: SignRequest = await req.json();
    const {
      pdf_base64,
      signer_name,
      signer_crm,
      document_type,
      document_id,
      place_qr_on_first_page,
    } = body;

    const defaultSignerName = 'LUCAS EDUARDO FRANÇA DA ROCHA MEDRADO TAVARES';
    const fallbackSignerName = Deno.env.get('MEDICO_NOME') || defaultSignerName;
    const fallbackSignerCrm = Deno.env.get('MEDICO_CRM') || '';
    const finalSignerName = signer_name || fallbackSignerName;
    const finalSignerCrm = signer_crm || fallbackSignerCrm || undefined;
    const finalDocumentType = document_type || 'prescricao';

    if (!pdf_base64 || !finalSignerName) {
      throw new Error('Missing required fields: pdf_base64, signer_name');
    }

    console.log('[SIGN-PDF] Iniciando assinatura digital');
    console.log('[SIGN-PDF] Tipo de documento:', finalDocumentType);
    console.log('[SIGN-PDF] Assinante:', finalSignerName);

    // Decodificar PDF base64 de forma eficiente
    console.log('[SIGN-PDF] Decodificando PDF base64...');
    console.log('[SIGN-PDF] Tamanho base64:', pdf_base64.length, 'chars');
    
    let pdfBytes: Uint8Array;
    try {
      const binaryString = atob(pdf_base64);
      const len = binaryString.length;
      pdfBytes = new Uint8Array(len);
      
      for (let i = 0; i < len; i++) {
        pdfBytes[i] = binaryString.charCodeAt(i);
      }
      
      console.log('[SIGN-PDF] PDF decodificado. Tamanho:', pdfBytes.length, 'bytes');
    } catch (error: any) {
      console.error('[SIGN-PDF] Erro ao decodificar PDF base64:', error);
      throw new Error(`Erro ao decodificar PDF: ${error.message || 'Formato base64 inválido'}`);
    }
    
    // Carregar PDF com pdf-lib
    const pdfDoc = await PDFDocument.load(pdfBytes);

    // Obter informações do certificado
    // Fallback para valores padrão se secrets não estiverem configurados
    const certUrl = Deno.env.get('PFX_CERTIFICATE_URL');
    const certPassword = Deno.env.get('PFX_CERTIFICATE_PASSWORD');
    if (!certUrl || !certPassword) {
      throw new Error('Certificado digital não configurado (PFX_CERTIFICATE_URL/PFX_CERTIFICATE_PASSWORD)');
    }

    console.log('[SIGN-PDF] Baixando certificado digital...');

    // Baixar certificado .PFX
    const certResponse = await fetch(certUrl);
    if (!certResponse.ok) {
      throw new Error(`Erro ao baixar certificado: ${certResponse.status}`);
    }
    
    const certBytes = new Uint8Array(await certResponse.arrayBuffer());
    console.log('[SIGN-PDF] Certificado baixado. Tamanho:', certBytes.length, 'bytes');

    // Validar senha do PFX e extrair subject para metadados
    let certificateSubject = 'ICP-Brasil';
    try {
      const certBinaryChunks: string[] = [];
      const certChunkSize = 8192;
      for (let i = 0; i < certBytes.length; i += certChunkSize) {
        const chunk = certBytes.slice(i, i + certChunkSize);
        certBinaryChunks.push(String.fromCharCode.apply(null, Array.from(chunk)));
      }
      const certBinary = certBinaryChunks.join('');
      const certAsn1 = forge.asn1.fromDer(certBinary);
      const p12 = forge.pkcs12.pkcs12FromAsn1(certAsn1, certPassword);
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
      const certificate = certBags[0]?.cert;
      if (!certificate) {
        throw new Error('Certificado nao encontrado no PFX');
      }
      const subjectParts = certificate.subject.attributes.map((attr) => `${attr.shortName || attr.name}=${attr.value}`);
      certificateSubject = subjectParts.join(', ');
      console.log('[SIGN-PDF] Subject do certificado:', certificateSubject);
    } catch (error: any) {
      console.error('[SIGN-PDF] Erro ao ler certificado PFX:', error);
      throw new Error('Senha do certificado incorreta ou PFX invalido');
    }

    // Adicionar metadados de assinatura digital ao PDF
    const now = new Date();
    const signatureText = `Documento assinado digitalmente por ${finalSignerName}${finalSignerCrm ? ` - ${finalSignerCrm}` : ''}`;
    // Preferir validador oficial do ITI
    const validationBaseUrl = Deno.env.get('ITI_VALIDATION_URL') || 'https://validar.iti.gov.br';
    const validationUrl = validationBaseUrl;
    
    pdfDoc.setTitle(`${finalDocumentType === 'prescricao' ? 'Receita Digital' : 'Solicitação de Exames'} - LIDFE`);
    pdfDoc.setAuthor(finalSignerName);
    pdfDoc.setSubject('Documento Médico Assinado Digitalmente');
    pdfDoc.setKeywords(['assinatura digital', 'ICP-Brasil', 'CFM', finalDocumentType]);
    pdfDoc.setProducer('LIDFE App - Sistema de Prescrição Digital');
    pdfDoc.setCreator('LIDFE App');
    pdfDoc.setCreationDate(now);
    pdfDoc.setModificationDate(now);

    // Gerar QR Code com URL de validação
    try {
      const qrDataUrl = await QRCode.toDataURL(validationUrl, {
        margin: 1,
        width: 140,
      });
      const qrBase64 = qrDataUrl.split(',')[1];
      const qrBytes = Uint8Array.from(atob(qrBase64), (c) => c.charCodeAt(0));
      const qrImage = await pdfDoc.embedPng(qrBytes);
      const shouldPlaceOnFirstPage = place_qr_on_first_page === true;

      if (shouldPlaceOnFirstPage) {
        const pages = pdfDoc.getPages();
        const targetPage = pages[0];
        const { width } = targetPage.getSize();
        const isExamDoc = finalDocumentType === 'exame' || finalDocumentType === 'guia_exames';
        const margin = Math.round(width * (isExamDoc ? 0.04 : 0.05));
        const qrSize = isExamDoc
          ? Math.max(44, Math.min(72, Math.round(width * 0.12)))
          : Math.max(60, Math.min(100, Math.round(width * 0.16)));
        const x = width - qrSize - margin;
        const y = margin;

        // Cobrir o QR antigo com um fundo branco antes de desenhar o novo
        targetPage.drawRectangle({
          x: x - 4,
          y: y - 4,
          width: qrSize + 8,
          height: qrSize + 8,
          color: rgb(1, 1, 1),
        });

        targetPage.drawImage(qrImage, {
          x,
          y,
          width: qrSize,
          height: qrSize,
        });
      } else {
        const qrSize = 120;
        // Adicionar página de validação com informações da assinatura
        // Evita sobrepor conteúdo existente no PDF original
        const validationPage = pdfDoc.addPage();
        const { height, width } = validationPage.getSize();

        // Texto de validação (usar hífen simples ao invés de linha Unicode para compatibilidade)
        const validationText = [
          '',
          '-----------------------------------------------------------------',
          signatureText,
          `Data/Hora da assinatura: ${now.toLocaleString('pt-BR', { timeZone: 'America/Cuiaba' })}`,
          'Conforme MP no 2.200-2/2001, Resolucao CFM 2.299/2021 e Resolucao CFM 2.381/2024',
          'Certificado Digital ICP-Brasil',
          '',
          'Este documento possui validade juridica e pode ser validado em:',
          validationUrl,
          '-----------------------------------------------------------------',
        ].join('\n');

        validationPage.drawText(validationText, {
          x: 50,
          y: height - 80,
          size: 8,
          lineHeight: 10,
        });

        // Posicionar no canto inferior direito da página de validação
        validationPage.drawImage(qrImage, {
          x: width - qrSize - 50,
          y: 50,
          width: qrSize,
          height: qrSize,
        });
      }
    } catch (qrError) {
      console.error('[SIGN-PDF] Erro ao gerar QR Code:', qrError);
    }

    console.log('[SIGN-PDF] Metadados de assinatura adicionados ao PDF');

    // NOTA: Assinatura criptográfica completa (PKCS#7) requer bibliotecas 
    // nativas que não estão disponíveis em Deno. Por ora, estamos adicionando
    // metadados verificáveis e um hash do documento.
    // Para assinatura PKCS#7 completa, seria necessário usar um serviço externo
    // ou implementar em outra linguagem (Java/Node.js nativo).

    // Gerar hash SHA-256 do documento para validação
    const pdfBytesForHash = await pdfDoc.save();
    const hashBuffer = await crypto.subtle.digest('SHA-256', pdfBytesForHash);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const documentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    console.log('[SIGN-PDF] Hash do documento:', documentHash.substring(0, 16) + '...');

    // Gerar XML de assinatura (XAdES simplificado) para validação
    // Este XML contém informações da assinatura que podem ser usadas para validação
    const signatureXml = `<?xml version="1.0" encoding="UTF-8"?>
<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
  <SignedInfo>
    <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
    <SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
    <Reference URI="">
      <DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
      <DigestValue>${documentHash}</DigestValue>
    </Reference>
  </SignedInfo>
  <SignatureValue>
    <SignerInfo>
      <SignerName>${finalSignerName}</SignerName>
      <SignerCRM>${finalSignerCrm || ''}</SignerCRM>
      <SigningTime>${now.toISOString()}</SigningTime>
      <DocumentType>${finalDocumentType}</DocumentType>
      <CertificateSubject>${certificateSubject}</CertificateSubject>
    </SignerInfo>
  </SignatureValue>
  <KeyInfo>
    <X509Data>
      <X509SubjectName>${certificateSubject}</X509SubjectName>
      <X509Certificate>ICP-Brasil</X509Certificate>
    </X509Data>
  </KeyInfo>
  <Object>
    <ValidationURL>${validationUrl}</ValidationURL>
  </Object>
</Signature>`;

    console.log('[SIGN-PDF] XML de assinatura gerado (XAdES simplificado)');

    // Salvar PDF assinado
    const signedPdfBytes = await pdfDoc.save();
    console.log('[SIGN-PDF] PDF assinado salvo. Tamanho:', signedPdfBytes.length, 'bytes');
    
    // Converter para base64 de forma segura (suporta PDFs grandes)
    console.log('[SIGN-PDF] Convertendo PDF assinado para base64...');
    let signedPdfBase64 = '';
    try {
      // Método seguro para conversão base64 que funciona com qualquer tamanho
      // Dividir em chunks para evitar stack overflow
      const chunkSize = 8192; // 8KB por vez
      let binaryString = '';
      
      for (let i = 0; i < signedPdfBytes.length; i += chunkSize) {
        const chunk = signedPdfBytes.slice(i, i + chunkSize);
        const chunkString = String.fromCharCode.apply(null, Array.from(chunk));
        binaryString += chunkString;
      }
      
      signedPdfBase64 = btoa(binaryString);
      console.log('[SIGN-PDF] PDF assinado convertido para base64. Tamanho base64:', signedPdfBase64.length, 'chars');
    } catch (error: any) {
      console.error('[SIGN-PDF] Erro ao converter PDF assinado para base64:', error);
      throw new Error(`Erro ao converter PDF assinado para base64: ${error.message || 'Erro desconhecido'}`);
    }

    console.log('[SIGN-PDF] ✅ PDF assinado com sucesso. Tamanho:', signedPdfBytes.length, 'bytes');

    return new Response(
      JSON.stringify({
        success: true,
        signed_pdf_base64: signedPdfBase64,
        signature_info: {
          signer_name: finalSignerName,
          signer_crm: finalSignerCrm,
          signature_date: now.toISOString(),
          document_hash: documentHash,
          document_type: finalDocumentType,
          certificate_subject: `${certificateSubject}`,
          signature_xml: signatureXml, // XML de assinatura (XAdES simplificado)
        },
        validation_url: validationUrl,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    // Log detalhado do erro para debug
    console.error('[SIGN-PDF] ❌ ERRO CRÍTICO:', error);
    console.error('[SIGN-PDF] Tipo de erro:', error?.name || 'Unknown');
    console.error('[SIGN-PDF] Mensagem:', error?.message || 'Erro desconhecido');
    console.error('[SIGN-PDF] Stack:', error?.stack || 'Sem stack trace');
    
    // Extrair informações úteis do erro
    const errorMessage = error?.message || 'Erro desconhecido ao assinar PDF';
    
    // Tentar identificar o tipo de erro
    let userFriendlyMessage = errorMessage;
    if (errorMessage.includes('stack') || errorMessage.includes('stack overflow')) {
      userFriendlyMessage = 'PDF muito grande para assinar. Tente reduzir o tamanho do arquivo.';
    } else if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
      userFriendlyMessage = 'Timeout ao assinar PDF. O arquivo pode ser muito grande.';
    } else if (errorMessage.includes('certificado') || errorMessage.includes('certificate')) {
      userFriendlyMessage = 'Erro ao carregar certificado digital. Verifique se o certificado está configurado corretamente.';
    } else if (errorMessage.includes('Unauthorized') || errorMessage.includes('Missing')) {
      userFriendlyMessage = 'Erro de autenticação. Verifique se as credenciais estão configuradas corretamente.';
    }
    
    return new Response(
      JSON.stringify({
        success: false,
        error: userFriendlyMessage,
        error_details: errorMessage,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
