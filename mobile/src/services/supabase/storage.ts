import { supabase } from './client';

export const storageService = {
  async uploadFile(
    bucket: string,
    path: string,
    file: Blob | File,
    options?: {
      cacheControl?: string;
      contentType?: string;
      upsert?: boolean;
    }
  ): Promise<{ data: { path: string } | null; error: Error | null }> {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        cacheControl: options?.cacheControl || '3600',
        contentType: options?.contentType,
        upsert: options?.upsert || false,
      });
    
    return { data, error };
  },

  async downloadFile(
    bucket: string,
    path: string
  ): Promise<{ data: Blob | null; error: Error | null }> {
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(path);
    
    return { data, error };
  },

  async getPublicUrl(bucket: string, path: string): Promise<string> {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  },

  async deleteFile(
    bucket: string,
    paths: string[]
  ): Promise<{ data: any[] | null; error: Error | null }> {
    const { data, error } = await supabase.storage
      .from(bucket)
      .remove(paths);
    
    return { data, error };
  },

  async listFiles(
    bucket: string,
    path?: string,
    options?: {
      limit?: number;
      offset?: number;
      sortBy?: { column: string; order?: 'asc' | 'desc' };
    }
  ): Promise<{ data: any[] | null; error: Error | null }> {
    const { data, error } = await supabase.storage.from(bucket).list(path || '', {
      limit: options?.limit,
      offset: options?.offset,
      sortBy: options?.sortBy,
    });
    
    return { data, error };

  },
};

export default storageService;
