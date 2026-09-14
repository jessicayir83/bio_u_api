export interface JwtPayload {
  sub: number;
  username: string;
  roles: string[];
}

export interface AuthenticatedUser {
  userId: number;
  username: string;
  roles: string[];
}
