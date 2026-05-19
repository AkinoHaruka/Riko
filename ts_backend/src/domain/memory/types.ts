export interface Memory {
  id: string;
  key: string;
  content: string;
  source: string;
  type: string;
  created_at: string;
}

export interface MemoryCreateRequest {
  key: string;
  content: string;
  source?: string;
  type?: string;
}
