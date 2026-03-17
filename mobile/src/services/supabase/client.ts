import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Chaves públicas do Supabase (anon key é pública e aparece no navegador)
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 
  Constants.expoConfig?.extra?.supabaseUrl || 
  'https://xradpyucukbqaulzhdab.supabase.co';

const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  Constants.expoConfig?.extra?.supabaseAnonKey;

if (!supabaseAnonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY environment variable');
}

// Storage de auth:
// - Web: localStorage (expo-secure-store não funciona no browser)
// - Native: default do supabase-js (ou SecureStore em fase mobile)
const webAuthStorage = {
  getItem: (key: string) => {
    try {
      return Promise.resolve(window.localStorage.getItem(key));
    } catch {
      return Promise.resolve(null);
    }
  },
  setItem: (key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore
    }
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return Promise.resolve();
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? (webAuthStorage as any) : undefined,
    autoRefreshToken: true,
    persistSession: true,
    // No web, precisamos capturar o token no callback OAuth.
    detectSessionInUrl: Platform.OS === 'web',
  },
});

export default supabase;
