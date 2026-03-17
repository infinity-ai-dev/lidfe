export type MessageRole = 'user' | 'model' | 'assistant' | 'system';
export type MessageType = 'text' | 'audio' | 'file';

export interface ChatMessage {
  id: string;
  thread_id: string;
  message: string;
  role: MessageRole;
  type: MessageType;
  mime_type?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  file_type?: string | null;
  user_id: string;
  created_at: string;
  userName?: string;
  timestamp?: string | Date;
}

export interface Filters {
  [key: string]: any;
}

export interface User {
  id: string;
  email?: string;
  name?: string;
  avatar_url?: string;
  created_at: string;
}

export interface Exame {
  id: string;
  user_id: string;
  nome: string;
  data: string;
  resultado?: string;
  interpretacao?: string;
  created_at: string;
}

export interface Prescricao {
  id: string;
  user_id: string;
  paciente_nome: string;
  paciente_cpf: string;
  medicamentos: Medicamento[];
  observacoes?: string;
  created_at: string;
}

export interface Medicamento {
  nome: string;
  dosagem: string;
  frequencia: string;
  duracao: string;
  observacoes?: string;
}

export interface SSEEvent {
  type: string;
  data: any;
  id?: string;
  event?: string;
}
