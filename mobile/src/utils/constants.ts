import Constants from 'expo-constants';

const sanitizePublicUrl = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const lowered = value.toLowerCase();
  // Evitar endpoints locais em build de produção.
  if (lowered.includes('localhost') || lowered.includes('127.0.0.1')) {
    return undefined;
  }
  return value;
};

const agentIaSseUrl = sanitizePublicUrl(
  process.env.EXPO_PUBLIC_AGENT_IA_SSE_URL ||
    Constants.expoConfig?.extra?.agentIaSseUrl
);
const agentIaAuthToken =
  process.env.EXPO_PUBLIC_AGENT_IA_AUTH_TOKEN ||
  Constants.expoConfig?.extra?.agentIaAuthToken;
const sseAuthToken =
  process.env.EXPO_PUBLIC_SSE_AUTH_TOKEN ||
  Constants.expoConfig?.extra?.sseAuthToken ||
  agentIaAuthToken;

export const APP_CONFIG = {
  SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || 
    Constants.expoConfig?.extra?.supabaseUrl || 
    'https://xradpyucukbqaulzhdab.supabase.co',
  
  AGENT_IA_URL: process.env.EXPO_PUBLIC_AGENT_IA_URL || 
    Constants.expoConfig?.extra?.agentIaUrl || 
    'https://lidfe.mayacrm.shop/agent',
  // Endpoint SSE pode ser independente do agente para evitar /agent/sse no Traefik
  AGENT_IA_SSE_URL: agentIaSseUrl || 'https://lidfe.mayacrm.shop/sse',
  AGENT_IA_AUTH_TOKEN: agentIaAuthToken,
  SSE_AUTH_TOKEN: sseAuthToken,

  // URL de validação/autenticidade para QR Code do PDF
  VALIDATION_URL: process.env.EXPO_PUBLIC_VALIDATION_URL ||
    Constants.expoConfig?.extra?.validationUrl ||
    'https://validar.iti.gov.br',

  // WhatsApp do laboratório no formato internacional (ex: 5565999999999)
  LAB_WHATSAPP_NUMBER: process.env.EXPO_PUBLIC_LAB_WHATSAPP ||
    Constants.expoConfig?.extra?.labWhatsappNumber ||
    '',
  
  APP_ENV: process.env.EXPO_PUBLIC_APP_ENV || 
    Constants.expoConfig?.extra?.appEnv || 
    'production',
};

export const STORAGE_KEYS = {
  QR_CODE_DATA: 'ff_qrCodeData',
  URL_IMAGE_AVATAR: 'ff_urlimageavatar',
  USER_MASCULINO: 'ff_usermasculino',
  USER_FEMININO: 'ff_userfeminino',
  ID_THREAD_CONVERSA: 'ff_idthreadConversa',
  FILTERS: 'ff_filters',
  PRESCRICAO_FINAL: 'ff_prescricaofinal',
  THEME_MODE: 'ff_themeMode',
} as const;

export const ROUTES = {
  AUTH_HOME: '/auth/home',
  AUTH_PASSO_1: '/auth/passo1',
  AUTH_PASSO_2: '/auth/passo2',
  AUTH_PASSO_3: '/auth/passo3',
  AUTH_PASSO_4: '/auth/passo4',
  AUTH_PASSO_5: '/auth/passo5',
  AUTH_VERIFICAR_OTP: '/auth/verificar-otp',
  ESQUECI_SENHA: '/auth/esqueci-senha',
  NOVA_SENHA: '/auth/nova-senha',
  TERMOS_USO: '/auth/termos-uso',
  PRIVACIDADE: '/auth/privacidade',
  ONBOARDING: '/onboarding',
  PAINEL_CONTROLE: '/chat',
  HISTORICO_EXAMES: '/exames/historico',
  INTERPRETACAO_EXAMES: '/exames/interpretacao',
  PRESCRICAO_MEDICA: '/prescricao',
  PERFIL: '/perfil',
  TWO_FACTOR_AUTH: '/auth/two-factor',
} as const;

export const CHAT_CONFIG = {
  MAX_AUDIO_DURATION: 60, // segundos
  AUDIO_FORMAT: 'wav' as const,
  MESSAGE_TYPES: {
    TEXT: 'text',
    AUDIO: 'audio',
  } as const,
  ROLES: {
    USER: 'user',
    MODEL: 'model',
  } as const,
};

export const PDF_TYPES = {
  PRESCRICAO: 'prescricao',
  GUIA_EXAME: 'guia_exame',
  REQUISICAO_EXAME: 'requisicao_exame',
  EXAME_02: 'exame_02',
} as const;
