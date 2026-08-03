import { apiRequest } from '../../api/client';

export type Institution = {
  id: string; name: string; institution_type: string; display_color: string | null;
  is_active: boolean; account_count: number; project_count: number;
};
export type Account = {
  id: string; institution_id: string | null; name: string; account_type: string;
  masked_identifier: string | null; display_color: string | null; is_active: boolean; project_count: number;
};
export type Project = {
  id: string; account_id: string; name: string; asset_type: string; currency_code: string;
  default_liquidity_level: string; default_risk_level: string; is_active: boolean; notes: string | null;
};

export type InstitutionInput = { name: string; institutionType: string; displayColor?: string; isActive: boolean };
export type AccountInput = { institutionId?: string | null; name: string; accountType: string; maskedIdentifier?: string; displayColor?: string; isActive: boolean };
export type ProjectInput = { accountId: string; name: string; assetType: string; currencyCode: string; defaultLiquidityLevel: string; defaultRiskLevel: string; isActive: boolean; notes?: string };

export const getInstitutions = () => apiRequest<Institution[]>('/institutions');
export const createInstitution = (value: InstitutionInput) => apiRequest<Institution>('/institutions', { method: 'POST', body: JSON.stringify(value) });
export const updateInstitution = (id: string, value: InstitutionInput) => apiRequest<Institution>(`/institutions/${id}`, { method: 'PUT', body: JSON.stringify(value) });
export const getAccounts = (institutionId: string) => apiRequest<Account[]>(`/institutions/${institutionId}/accounts`);
export const getUnassignedAccounts = () => apiRequest<Account[]>('/accounts/unassigned');
export const createAccount = (value: AccountInput) => apiRequest<Account>('/accounts', { method: 'POST', body: JSON.stringify(value) });
export const updateAccount = (id: string, value: AccountInput) => apiRequest<Account>(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(value) });
export const getProjects = (accountId: string) => apiRequest<Project[]>(`/accounts/${accountId}/projects`);
export const createProject = (value: ProjectInput) => apiRequest<Project>('/projects', { method: 'POST', body: JSON.stringify(value) });
export const updateProject = (id: string, value: ProjectInput) => apiRequest<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(value) });
export const deactivateProject = (id: string) => apiRequest<Project>(`/projects/${id}/deactivate`, { method: 'POST' });
