export interface RegisterRequest {
  username: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthUser {
  userId: string;
  username: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    username: string;
  };
}
