export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  is_archived: number;
  background: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateConversationRequest {
  title: string;
}

export interface UpdateConversationRequest {
  title?: string | null;
  is_archived?: number | null;
  background?: string | null;
}
