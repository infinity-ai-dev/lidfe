// Cliente para chamadas à API Gemini
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GeminiMessage, GeminiResponse, FunctionCallResult } from './types';
import { SYSTEM_PROMPT } from './prompt';
import { getTools } from './tools';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-2.5-pro';
const GEMINI_FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.0-flash'];
const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';

export class GeminiClient {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private ttsModel: any;
  private apiKey: string;
  private fileManager: GoogleAIFileManager | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: GEMINI_MODEL });
    this.ttsModel = this.genAI.getGenerativeModel({ model: GEMINI_TTS_MODEL });
  }

  private getFileManager(): GoogleAIFileManager {
    if (!this.fileManager) {
      this.fileManager = new GoogleAIFileManager(this.apiKey);
    }
    return this.fileManager;
  }

  private getExamPrompt(prompt?: string): string {
    if (prompt) return prompt;
    return `Você é um assistente médico especializado em análise de exames laboratoriais e de imagem. Analise o documento fornecido (que pode ser um PDF ou imagem de exame) e forneça uma interpretação clara, acessível e didática em linguagem natural.

IMPORTANTE: Analise cuidadosamente o documento, prestando atenção a:
- Tabelas com valores e referências
- Diagramas ou gráficos
- Texto impresso ou manuscrito (use OCR se necessário)
- Campos identificadores do exame (tipo, data, paciente)
- Valores numéricos e suas unidades

Forneça uma resposta estruturada explicando:

1. **Tipo de Exame Identificado**: Identifique claramente o tipo de exame (ex: Hemograma, Glicemia, Colesterol, Raio-X, etc.)

2. **Principais Valores Encontrados**: Liste os principais valores encontrados no exame, organizados de forma clara

3. **Alterações Detectadas**: Identifique valores que estão fora da normalidade (se houver), indicando:
   - O valor encontrado
   - O valor de referência normal
   - Se está acima ou abaixo do normal
   - O que isso pode significar de forma simples

4. **Interpretação Geral**: Forneça uma interpretação geral do exame em linguagem acessível ao paciente, explicando:
   - O que o exame mostra
   - Se há alguma alteração preocupante
   - O que cada alteração pode significar (sem fazer diagnóstico definitivo)

5. **Próximos Passos**: Se necessário, sugira próximos passos ou acompanhamento

REGras:
- Use linguagem clara e acessível, evitando termos muito técnicos ou jargão médico desnecessário
- Se usar termos técnicos, explique seu significado de forma simples
- Explique cada alteração de forma didática, ajudando o paciente a entender
- Seja objetivo e direto, mas completo
- Foque em orientar o paciente de forma compreensível
- NÃO faça diagnósticos definitivos - apenas interprete os resultados
- Se o documento tiver tabelas complexas ou gráficos, explique o que eles mostram de forma clara
- Se houver ambiguidade ou texto ilegível, mencione isso na interpretação`;
  }

  private sanitizeFileName(fileName: string): string {
    return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private inferFileExtension(mimeType: string): string {
    if (mimeType === 'application/pdf') return '.pdf';
    if (mimeType === 'image/jpeg') return '.jpg';
    if (mimeType === 'image/png') return '.png';
    if (mimeType === 'image/webp') return '.webp';
    if (mimeType === 'image/gif') return '.gif';
    return '';
  }

  async uploadExamFileToGoogle(params: {
    fileBase64: string;
    mimeType: string;
    fileName?: string | null;
  }): Promise<{ fileUri: string }> {
    const { fileBase64, mimeType, fileName } = params;

    const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    const fileBuffer = Buffer.from(cleanBase64, 'base64');
    const safeNameBase = this.sanitizeFileName(fileName || 'exame');
    const extension = safeNameBase.includes('.') ? '' : this.inferFileExtension(mimeType);
    const safeName = `${safeNameBase}${extension}`;
    const tempPath = path.join(os.tmpdir(), `lidfe-${Date.now()}-${safeName}`);

    await fs.promises.writeFile(tempPath, fileBuffer);

    try {
      const fileManager = this.getFileManager();
      const response = await fileManager.uploadFile(tempPath, {
        mimeType,
        displayName: safeName,
      });
      const fileUri = response?.file?.uri;
      if (!fileUri) {
        throw new Error('File URI não retornada pela API do Google');
      }
      return { fileUri };
    } finally {
      await fs.promises.unlink(tempPath).catch(() => undefined);
    }
  }

  private getUsageTokens(data: any): number {
    const usage = data?.usageMetadata;
    if (!usage) return 0;

    const total = usage?.totalTokenCount;
    if (typeof total === 'number' && Number.isFinite(total)) return total;

    const prompt = typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : 0;
    const candidates = typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : 0;
    const sum = prompt + candidates;
    return Number.isFinite(sum) ? sum : 0;
  }

  private async wait(ms: number): Promise<void> {
    // Pausa simples para politicas de retry.
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  private async requestWithRetry(
    buildRequest: (model: string) => Promise<Response>,
    models: string[]
  ): Promise<Response> {
    // Retry: 3 tentativas com 1s entre elas; se falhar, aguarda 5s e tenta mais 1 vez.
    const retryDelayMs = 1000;
    const finalWaitMs = 5000;
    const maxRetries = 3;

    for (const model of models) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const response = await buildRequest(model);
        if (response.ok) return response;

        const errorText = await response.text();
        const isRateLimit = response.status === 429 || /RESOURCE_EXHAUSTED/i.test(errorText);
        const shouldRetry = isRateLimit && attempt < maxRetries;

        if (shouldRetry) {
          console.warn(`[GEMINI] Rate limit (${response.status}) no modelo ${model}. Tentativa ${attempt + 1}/${maxRetries + 1} em ${retryDelayMs}ms...`);
          await this.wait(retryDelayMs);
          continue;
        }

        // Se nao for rate limit, devolver response para tratamento normal.
        if (!isRateLimit) return new Response(errorText, { status: response.status, statusText: response.statusText });

        // Rate limit persistente: esperar e tentar proximo modelo
        console.warn(`[GEMINI] Rate limit persistente no modelo ${model}. Aguardando ${finalWaitMs}ms para fallback...`);
        await this.wait(finalWaitMs);
        break;
      }
    }

    return new Response('Rate limit em todos os modelos', { status: 429, statusText: 'RESOURCE_EXHAUSTED' });
  }

  /**
   * Chama a API Gemini para gerar resposta
   */
  async generateContent(
    messages: GeminiMessage[],
    tools: any[]
  ): Promise<GeminiResponse> {
    try {
      console.log('[GEMINI] Preparando chamada à API...');
      console.log(`[GEMINI] Número de mensagens: ${messages.length}`);
      console.log(`[GEMINI] Número de tools: ${tools.length}`);

      // Preparar contents no formato Gemini
      const contents = [
        {
          role: 'user',
          parts: [{ text: SYSTEM_PROMPT }],
        },
        ...messages,
      ];

      // Preparar request body
      const requestBody: any = {
        contents,
        tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
        generationConfig: {
          temperature: 0.3, // Consistência e aderência às instruções
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
          // thinkingConfig removido: alguns modelos exigem thinking mode e rejeitam budget=0
        },
      };

      // Fazer chamada HTTP direta (SDK não suporta tools ainda)
      const response = await this.requestWithRetry(
        (model) => fetch(
          `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${this.apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          }
        ),
        GEMINI_FALLBACK_MODELS
      );

      // Verificar se é rate limit (429) - retornar Response para ser tratado no orchestrator
      if (response.status === 429) {
        return response as any; // Retornar Response para ser detectado no orchestrator
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('[GEMINI] Resposta recebida');
      return data as GeminiResponse;
    } catch (error: any) {
      console.error('[GEMINI] Erro ao chamar API:', error);
      throw error;
    }
  }

  /**
   * Chama Gemini novamente com resultado de function call
   */
  async generateContentWithFunctionResult(
    messages: GeminiMessage[],
    functionCall: { name: string; args: Record<string, any> },
    functionResult: FunctionCallResult
  ): Promise<GeminiResponse> {
    try {
      console.log('[GEMINI] Chamando com resultado de function...');

      // Adicionar function response ao histórico
      const updatedMessages: GeminiMessage[] = [
        ...messages,
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: functionCall.name,
                response: {
                  output: functionResult.output,
                },
              },
            },
          ],
        },
      ];

      // Buscar tools novamente
      const tools = getTools();

      return await this.generateContent(updatedMessages, tools);
    } catch (error: any) {
      console.error('[GEMINI] Erro ao chamar com function result:', error);
      throw error;
    }
  }

  /**
   * Gera TTS (text-to-speech) usando Gemini
   */
  async generateTTS(text: string): Promise<{ audioBase64: string | null; tokensUsed: number }> {
    try {
      console.log('[GEMINI-TTS] Gerando áudio para texto...');

      const requestBody = {
        contents: [
          {
            parts: [{ text }],
          },
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Kore',
              },
            },
          },
        },
      };

      const response = await this.requestWithRetry(
        (model) => fetch(
          `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${this.apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          }
        ),
        [GEMINI_TTS_MODEL]
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini TTS API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      const tokensUsed = this.getUsageTokens(data);

      // Extrair áudio PCM do response
      const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      const mimeType = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType;

      if (!audioData) {
        console.warn('[GEMINI-TTS] ⚠️ Nenhum áudio retornado');
        return { audioBase64: null, tokensUsed };
      }

      // Converter PCM para WAV base64
      const wavBase64 = await this.convertPCMToWAV(audioData, mimeType);
      console.log('[GEMINI-TTS] Áudio gerado com sucesso');
      // Retornar apenas base64 puro (sem prefixo data:audio)
      // O prefixo será adicionado apenas no frontend ao reproduzir
      return { audioBase64: wavBase64, tokensUsed };
    } catch (error: any) {
      console.error('[GEMINI-TTS] Erro ao gerar TTS:', error);
      return { audioBase64: null, tokensUsed: 0 };
    }
  }

  /**
   * Transcreve áudio usando Gemini
   * @param audioBase64 O áudio em formato Base64
   * @param mimeType O tipo MIME do áudio (ex: 'audio/wav', 'audio/webm'). Default: 'audio/wav'
   */
  async transcribeAudio(
    audioBase64: string,
    mimeType: string = 'audio/wav'
  ): Promise<{ text: string; tokensUsed: number }> {
    try {
      console.log('[GEMINI] Transcrevendo áudio...');

      // audioBase64 já está pronto para ser enviado como inlineData

      // Preparar request com áudio inline
      const requestBody = {
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: mimeType, // Usar mimeType do parâmetro
                  data: audioBase64,
                },
              },
              {
                text: 'Transcreva este áudio para texto em português brasileiro.',
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
        },
      };

      const response = await this.requestWithRetry(
        (model) => fetch(
          `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${this.apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          }
        ),
        GEMINI_FALLBACK_MODELS
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini Transcription error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      const tokensUsed = this.getUsageTokens(data);
      const transcription =
        data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      console.log(`[GEMINI] Transcrição: ${transcription.substring(0, 100)}...`);
      return { text: transcription, tokensUsed };
    } catch (error: any) {
      console.error('[GEMINI] Erro ao transcrever áudio:', error);
      throw error;
    }
  }

  /**
   * Valida MIME type e tamanho do arquivo
   */
  private validateFileInput(fileBase64: string, mimeType: string): { valid: boolean; error?: string } {
    // MIME types suportados conforme documentação Gemini
    const supportedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ];

    if (!supportedMimeTypes.includes(mimeType)) {
      return {
        valid: false,
        error: `Tipo de arquivo não suportado: ${mimeType}. Tipos aceitos: ${supportedMimeTypes.join(', ')}`,
      };
    }

    // Calcular tamanho aproximado do arquivo (base64 é ~33% maior que binário)
    // Limite: 20MB para inlineData (recomendado pela documentação)
    const base64Size = fileBase64.length;
    const estimatedBinarySize = (base64Size * 3) / 4;
    const maxSizeBytes = 20 * 1024 * 1024; // 20MB

    if (estimatedBinarySize > maxSizeBytes) {
      return {
        valid: false,
        error: `Arquivo muito grande (${Math.round(estimatedBinarySize / 1024 / 1024)}MB). Tamanho máximo: 20MB para upload direto.`,
      };
    }

    return { valid: true };
  }

  /**
   * Analisa um exame (PDF ou imagem) e retorna interpretação em linguagem natural
   * Este método usa o modelo vision do Gemini para analisar documentos médicos
   * Usa inlineData para arquivos até 20MB (recomendado pela documentação)
   */
  async analyzeExame(
    fileBase64: string,
    mimeType: string,
    prompt?: string
  ): Promise<{ interpretation: string; tokensUsed: number }> {
    try {
      console.log('[GEMINI] Analisando exame...');
      console.log(`[GEMINI] Tipo MIME: ${mimeType}`);
      console.log(`[GEMINI] Tamanho base64: ${fileBase64.length} caracteres`);

      // Validar entrada
      const validation = this.validateFileInput(fileBase64, mimeType);
      if (!validation.valid) {
        throw new Error(validation.error || 'Validação de arquivo falhou');
      }

      const analysisPrompt = this.getExamPrompt(prompt);

      // Preparar requisição com arquivo inline
      const requestBody = {
        contents: [
          {
            parts: [
              { text: analysisPrompt },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: fileBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2, // Baixa temperatura para consistência médica
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
      };

      // Usar gemini-1.5-pro para análise de documentos (suporta PDF e imagens nativamente)
      // Este modelo é especificamente recomendado para análise de documentos médicos
      const model = 'gemini-1.5-pro';
      
      console.log(`[GEMINI] Chamando modelo ${model} para análise de exame...`);
      const response = await this.requestWithRetry(
        (model) => fetch(
          `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${this.apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          }
        ),
        [model] // Usar apenas gemini-1.5-pro para análise de documentos (não usar fallbacks que podem não suportar PDF)
      );

      if (response.status === 429) {
        throw new Error('Rate limit atingido ao analisar exame');
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro ao analisar exame: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      const tokensUsed = this.getUsageTokens(data);
      const interpretation = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      console.log(`[GEMINI] Interpretação gerada (${interpretation.length} caracteres)`);
      return { interpretation, tokensUsed };
    } catch (error: any) {
      console.error('[GEMINI] Erro ao analisar exame:', error);
      throw error;
    }
  }

  async analyzeExameFromFileUri(
    fileUri: string,
    mimeType: string,
    prompt?: string
  ): Promise<{ interpretation: string; tokensUsed: number }> {
    try {
      console.log('[GEMINI] Analisando exame via File URI...');
      console.log(`[GEMINI] File URI: ${fileUri}`);
      console.log(`[GEMINI] Tipo MIME: ${mimeType}`);

      const analysisPrompt = this.getExamPrompt(prompt);

      const requestBody = {
        contents: [
          {
            parts: [
              { text: analysisPrompt },
              {
                fileData: {
                  mimeType,
                  fileUri,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
      };

      const model = 'gemini-1.5-pro';
      console.log(`[GEMINI] Chamando modelo ${model} para análise de exame com File URI...`);
      const response = await this.requestWithRetry(
        (model) =>
          fetch(`${GEMINI_BASE_URL}/models/${model}:generateContent?key=${this.apiKey}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          }),
        [model]
      );

      if (response.status === 429) {
        throw new Error('Rate limit atingido ao analisar exame');
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro ao analisar exame: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      const tokensUsed = this.getUsageTokens(data);
      const interpretation = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      console.log(`[GEMINI] Interpretação gerada (${interpretation.length} caracteres)`);
      return { interpretation, tokensUsed };
    } catch (error: any) {
      console.error('[GEMINI] Erro ao analisar exame via File URI:', error);
      throw error;
    }
  }

  /**
   * Analisa exame a partir de URL (baixa o arquivo e analisa)
   * Valida tamanho e tipo antes de processar
   */
  async analyzeExameFromUrl(
    fileUrl: string,
    mimeType: string,
    prompt?: string
  ): Promise<{ interpretation: string; tokensUsed: number }> {
    try {
      console.log('[GEMINI] Baixando arquivo de exame de URL...');
      console.log(`[GEMINI] URL: ${fileUrl}`);
      console.log(`[GEMINI] MIME type esperado: ${mimeType}`);
      
      // Baixar o arquivo
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) {
        const errorText = await fileResponse.text().catch(() => '');
        throw new Error(`Erro ao baixar arquivo: ${fileResponse.status} ${fileResponse.statusText}${errorText ? ` - ${errorText}` : ''}`);
      }

      // Detectar MIME type real do Content-Type se não fornecido
      const contentType = fileResponse.headers.get('content-type');
      const detectedMimeType = contentType || mimeType;
      
      if (mimeType !== detectedMimeType) {
        console.log(`[GEMINI] ⚠️ MIME type detectado (${detectedMimeType}) difere do esperado (${mimeType}). Usando detectado.`);
      }

      // Verificar tamanho (limite do Gemini: 20MB para inlineData)
      const contentLength = fileResponse.headers.get('content-length');
      if (contentLength) {
        const fileSizeBytes = parseInt(contentLength);
        const maxSizeBytes = 20 * 1024 * 1024; // 20MB
        
        if (fileSizeBytes > maxSizeBytes) {
          throw new Error(`Arquivo muito grande (${Math.round(fileSizeBytes / 1024 / 1024)}MB). Tamanho máximo: 20MB para upload direto. Para arquivos maiores, use a Files API.`);
        }
        
        console.log(`[GEMINI] Tamanho do arquivo: ${Math.round(fileSizeBytes / 1024)}KB`);
      }

      // Converter para base64
      const fileBytes = await fileResponse.arrayBuffer();
      const fileBase64 = Buffer.from(fileBytes).toString('base64');

      console.log(`[GEMINI] Arquivo baixado com sucesso (${fileBytes.byteLength} bytes, ${fileBase64.length} caracteres base64)`);

      // Analisar usando o método principal (que já valida MIME e tamanho)
      return await this.analyzeExame(fileBase64, detectedMimeType, prompt);
    } catch (error: any) {
      console.error('[GEMINI] ❌ Erro ao analisar exame de URL:', error);
      throw error;
    }
  }

  /**
   * Converte PCM para WAV base64
   */
  private async convertPCMToWAV(
    pcmBase64: string,
    mimeType: string
  ): Promise<string> {
    try {
      // Extrair sample rate do mimeType (ex: audio/L16;codec=pcm;rate=24000)
      const sampleRateMatch = mimeType.match(/rate=(\d+)/);
      const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1]) : 24000;

      // Converter PCM base64 para buffer
      const pcmBuffer = Buffer.from(pcmBase64, 'base64');

      // Criar header WAV
      const wavHeader = this.createWAVHeader(pcmBuffer.length, sampleRate, 1, 16);

      // Combinar header + dados PCM
      const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);

      // Converter para base64
      return wavBuffer.toString('base64');
    } catch (error: any) {
      console.error('[GEMINI-TTS] Erro ao converter PCM para WAV:', error);
      throw error;
    }
  }

  /**
   * Cria header WAV
   */
  private createWAVHeader(
    audioLength: number,
    sampleRate: number = 24000,
    channels: number = 1,
    bitsPerSample: number = 16
  ): Buffer {
    const buffer = Buffer.alloc(44);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + audioLength, 4);
    buffer.write('WAVE', 8);

    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 28); // byte rate
    buffer.writeUInt16LE((channels * bitsPerSample) / 8, 32); // block align
    buffer.writeUInt16LE(bitsPerSample, 34);

    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(audioLength, 40);

    return buffer;
  }
}
