import { supabase } from './supabase/client';
import * as Crypto from 'expo-crypto';
import { authenticator } from 'otplib';

export interface TwoFactorAuthResponse {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

export interface VerifyTOTPResponse {
  valid: boolean;
  message?: string;
}

function generateSecret(): string {
  // Gera um secret base32 de 32 caracteres
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let secret = '';
  for (let i = 0; i < 32; i++) {
    secret += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return secret;
}

export const twoFactorAuthService = {
  async generateTwoFactorAuth(
    userId: string,
    userEmail: string
  ): Promise<TwoFactorAuthResponse> {
    try {
      const secret = generateSecret();
      const issuer = 'LIDFE';
      const accountName = userEmail;

      // Gerar QR code URL (formato otpauth://)
      const qrCodeUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

      // Gerar códigos de backup
      const backupCodes: string[] = [];
      for (let i = 0; i < 10; i++) {
        backupCodes.push(Crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase());
      }

      // Verificar se já existe configuração
      const { data: existing } = await supabase
        .from('user_two_factor_auth')
        .select('*')
        .eq('user_id', userId)
        .single();

      const now = new Date().toISOString();

      if (existing) {
        // Atualizar existente
        await supabase
          .from('user_two_factor_auth')
          .update({
            secret,
            enabled: false,
            updated_at: now,
          })
          .eq('user_id', userId);
      } else {
        // Criar novo
        await supabase
          .from('user_two_factor_auth')
          .insert({
            user_id: userId,
            secret,
            enabled: false,
            created_at: now,
            updated_at: now,
          });
      }

      return {
        secret,
        qrCodeUrl,
        backupCodes,
      };
    } catch (error: any) {
      console.error('[2FA] Erro ao gerar 2FA:', error);
      throw error;
    }
  },

  async verifyAndEnable(
    userId: string,
    code: string
  ): Promise<VerifyTOTPResponse> {
    try {
      // Buscar secret do usuário
      const { data, error } = await supabase
        .from('user_two_factor_auth')
        .select('secret')
        .eq('user_id', userId)
        .single();

      if (error || !data?.secret) {
        return {
          valid: false,
          message: 'Configuração 2FA não encontrada',
        };
      }

      // Verificar código TOTP
      const isValid = authenticator.verify({ token: code, secret: data.secret });

      if (isValid) {
        // Habilitar 2FA
        await supabase
          .from('user_two_factor_auth')
          .update({
            enabled: true,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);

        return {
          valid: true,
          message: '2FA habilitado com sucesso',
        };
      }

      return {
        valid: false,
        message: 'Código inválido',
      };
    } catch (error: any) {
      console.error('[2FA] Erro ao verificar código:', error);
      return {
        valid: false,
        message: error.message || 'Erro ao verificar código',
      };
    }
  },

  async verifyCode(userId: string, code: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('user_two_factor_auth')
        .select('secret, enabled')
        .eq('user_id', userId)
        .single();

      if (error || !data?.secret || !data.enabled) {
        return false;
      }

      return authenticator.verify({ token: code, secret: data.secret });
    } catch (error) {
      console.error('[2FA] Erro ao verificar código:', error);
      return false;
    }
  },

  async disable(userId: string): Promise<void> {
    try {
      await supabase
        .from('user_two_factor_auth')
        .update({
          enabled: false,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    } catch (error: any) {
      console.error('[2FA] Erro ao desabilitar 2FA:', error);
      throw error;
    }
  },

  async isEnabled(userId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('user_two_factor_auth')
        .select('enabled')
        .eq('user_id', userId)
        .single();

      if (error || !data) {
        return false;
      }

      return data.enabled === true;
    } catch (error) {
      console.error('[2FA] Erro ao verificar status:', error);
      return false;
    }
  },
};

export default twoFactorAuthService;
