export interface ChatEvent {
  user_id: string;
  thread_id: string;
  message: string;
  id?: string;
  role?: string;
  type?: string;
  audio_base64?: string;
  timestamp?: string;
}

export interface SSEMessage {
  type: 'connected' | 'message' | 'error';
  data?: any;
  timestamp?: string;
}
