import { apiRequest } from '../../api/client';

export type User = {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
};

export type LoginInput = { email: string; password: string };
export type UpdateProfileInput = { displayName: string };
export type ChangePasswordInput = { currentPassword: string; newPassword: string };
export type BootstrapInput = {
  bootstrapToken: string;
  email: string;
  displayName: string;
  password: string;
};

export const getSetupStatus = () => apiRequest<{ requires_setup: boolean }>('/setup/status');
export const getMe = () => apiRequest<User>('/auth/me');
export const updateProfile = (input: UpdateProfileInput) =>
  apiRequest<User>('/auth/profile', { method: 'PATCH', body: JSON.stringify(input) });
export const changePassword = (input: ChangePasswordInput) =>
  apiRequest<User>('/auth/change-password', { method: 'POST', body: JSON.stringify(input) });
export const login = (input: LoginInput) =>
  apiRequest<User>('/auth/login', { method: 'POST', body: JSON.stringify(input) });
export const bootstrap = (input: BootstrapInput) =>
  apiRequest<User>('/setup/bootstrap', { method: 'POST', body: JSON.stringify(input) });
export const logout = () => apiRequest<void>('/auth/logout', { method: 'POST' });
