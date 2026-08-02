import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined';
import AddOutlined from '@mui/icons-material/AddOutlined';
import BlockOutlined from '@mui/icons-material/BlockOutlined';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import WalletOutlined from '@mui/icons-material/WalletOutlined';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, FormHelperText, FormLabel, IconButton, List,
  ListItem, ListItemButton, MenuItem, Paper, Snackbar, Stack, Switch, TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiClientError } from '../../api/client';
import { getCurrencies } from '../settings/api';
import {
  createAccount, createInstitution, createProject, deactivateProject, getAccounts,
  getInstitutions, getProjects, updateAccount, updateInstitution, updateProject,
  type Account, type Institution, type Project,
} from './api';
import { containsFullAccountNumber } from './validation';

type EditorKind = 'institution' | 'account' | 'project';
type Values = Record<string, string | boolean>;
type Editor = { kind: EditorKind; id?: string; values: Values } | null;

const institutionTypes = [['bank', '银行'], ['broker', '券商'], ['cash', '现金'], ['person', '个人'], ['other', '其他']];
const accountTypes = [['savings', '储蓄账户'], ['wealth_management', '理财账户'], ['brokerage', '证券账户'], ['cash_wallet', '现金钱包'], ['loan_related', '借贷相关'], ['other', '其他']];
const assetTypes = [['bank_deposit', '银行存款'], ['cash', '现金'], ['securities', '证券']];
const liquidityLevels = [['t0', '随时可用'], ['within_7d', '7 天内'], ['within_30d', '30 天内'], ['within_90d', '90 天内'], ['locked_or_unknown', '锁定或未知']];
const riskLevels = [['low', '低风险'], ['medium', '中风险'], ['high', '高风险']];
const displayColors = ['#2f7d6d', '#397c93', '#66558c', '#9b6a22', '#a44740', '#40514d'];

function normalizeDisplayColor(value: string | null | undefined, fallback: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function ColorPickerField({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const selectedColor = normalizeDisplayColor(value, displayColors[0]);

  return (
    <FormControl fullWidth>
      <FormLabel sx={{ mb: 1, color: 'text.primary', fontSize: 13 }}>显示颜色</FormLabel>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {displayColors.map((color) => {
          const selected = selectedColor === color;
          return (
            <Box
              key={color}
              component="button"
              type="button"
              aria-label={`选择颜色 ${color.toUpperCase()}`}
              aria-pressed={selected}
              onClick={() => onChange(color)}
              sx={{
                width: 38,
                height: 38,
                p: 0,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                border: selected ? '3px solid' : '1px solid',
                borderColor: selected ? 'primary.dark' : 'divider',
                bgcolor: color,
                color: 'white',
                cursor: 'pointer',
                boxShadow: selected ? '0 0 0 2px white inset' : 'none',
                '&:focus-visible': { outline: '3px solid #397c93', outlineOffset: 2 },
              }}
            >
              {selected && <CheckOutlined fontSize="small" />}
            </Box>
          );
        })}
        <Box
          component="input"
          type="color"
          aria-label="选择自定义显示颜色"
          title="选择自定义显示颜色"
          value={selectedColor}
          onChange={(event) => onChange(event.target.value)}
          sx={{
            width: 44,
            height: 40,
            p: '3px',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1.5,
            bgcolor: 'background.paper',
            cursor: 'pointer',
            '&::-webkit-color-swatch-wrapper': { p: 0 },
            '&::-webkit-color-swatch': { border: 0, borderRadius: 1 },
          }}
        />
        <Chip size="small" label={selectedColor.toUpperCase()} sx={{ fontFamily: 'monospace' }} />
      </Stack>
      <FormHelperText sx={{ ml: 0 }}>选择预设颜色，或点击最后的色块打开自定义颜色选择器。</FormHelperText>
    </FormControl>
  );
}

function PanelHeader({ title, subtitle, onAdd, disabled = false }: { title: string; subtitle: string; onAdd: () => void; disabled?: boolean }) {
  return <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: '1px solid', borderColor: 'divider' }}><Box><Typography sx={{ fontWeight: 750 }}>{title}</Typography><Typography color="text.secondary" sx={{ fontSize: 11 }}>{subtitle}</Typography></Box><Button size="small" startIcon={<AddOutlined />} onClick={onAdd} disabled={disabled}>新增</Button></Stack>;
}

export function MasterDataPage() {
  const queryClient = useQueryClient();
  const [selectedInstitution, setSelectedInstitution] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [editor, setEditor] = useState<Editor>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const institutionsQuery = useQuery({ queryKey: ['institutions'], queryFn: getInstitutions });
  const institutions = institutionsQuery.data ?? [];
  const institutionId = institutions.some((item) => item.id === selectedInstitution) ? selectedInstitution : (institutions[0]?.id ?? '');
  const accountsQuery = useQuery({ queryKey: ['accounts', institutionId], queryFn: () => getAccounts(institutionId), enabled: Boolean(institutionId) });
  const accounts = accountsQuery.data ?? [];
  const accountId = accounts.some((item) => item.id === selectedAccount) ? selectedAccount : (accounts[0]?.id ?? '');
  const projectsQuery = useQuery({ queryKey: ['projects', accountId], queryFn: () => getProjects(accountId), enabled: Boolean(accountId) });
  const projects = projectsQuery.data ?? [];
  const currenciesQuery = useQuery({ queryKey: ['currencies'], queryFn: getCurrencies });
  const currencies = (currenciesQuery.data ?? []).filter((item) => item.enabled);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['institutions'] }),
      queryClient.invalidateQueries({ queryKey: ['accounts'] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['snapshots'] }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editor) return;
      const value = editor.values;
      if (editor.kind === 'institution') {
        const payload = { name: String(value.name), institutionType: String(value.type), displayColor: String(value.color), isActive: Boolean(value.active) };
        return editor.id ? updateInstitution(editor.id, payload) : createInstitution(payload);
      }
      if (editor.kind === 'account') {
        const maskedIdentifier = String(value.identifier);
        if (containsFullAccountNumber(maskedIdentifier)) throw new Error('只允许保存尾号或脱敏简称，不能保存完整账号');
        const payload = { institutionId: String(value.parent), name: String(value.name), accountType: String(value.type), maskedIdentifier, displayColor: String(value.color), isActive: Boolean(value.active) };
        return editor.id ? updateAccount(editor.id, payload) : createAccount(payload);
      }
      const payload = { accountId: String(value.parent), name: String(value.name), assetType: String(value.type), currencyCode: String(value.currency), defaultLiquidityLevel: String(value.liquidity), defaultRiskLevel: String(value.risk), isActive: Boolean(value.active), notes: String(value.notes) };
      return editor.id ? updateProject(editor.id, payload) : createProject(payload);
    },
    onSuccess: async () => { await invalidate(); setEditor(null); setNotice('保存成功'); },
  });
  const deactivateMutation = useMutation({ mutationFn: deactivateProject, onSuccess: async () => { await invalidate(); setNotice('项目已停用，历史数据仍会保留'); } });

  const openInstitution = (item?: Institution) => setEditor({ kind: 'institution', id: item?.id, values: { name: item?.name ?? '', type: item?.institution_type ?? 'bank', color: normalizeDisplayColor(item?.display_color, '#2f7d6d'), active: item?.is_active ?? true } });
  const openAccount = (item?: Account) => setEditor({ kind: 'account', id: item?.id, values: { parent: item?.institution_id ?? institutionId, name: item?.name ?? '', type: item?.account_type ?? (institutions.find((entry) => entry.id === institutionId)?.institution_type === 'cash' ? 'cash_wallet' : 'savings'), identifier: item?.masked_identifier ?? '', color: normalizeDisplayColor(item?.display_color, '#40514d'), active: item?.is_active ?? true } });
  const openProject = (item?: Project) => setEditor({ kind: 'project', id: item?.id, values: { parent: item?.account_id ?? accountId, name: item?.name ?? '', type: item?.asset_type ?? 'bank_deposit', currency: item?.currency_code ?? 'CNY', liquidity: item?.default_liquidity_level ?? 't0', risk: item?.default_risk_level ?? 'low', notes: item?.notes ?? '', active: item?.is_active ?? true } });
  const setValue = (key: string, value: string | boolean) => setEditor((current) => current ? { ...current, values: { ...current.values, [key]: value } } : current);
  const error = saveMutation.error ?? institutionsQuery.error ?? accountsQuery.error ?? projectsQuery.error;
  const errorMessage = error instanceof ApiClientError || error instanceof Error ? error.message : null;

  return <Box>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', mb: 3 }}><Box><Typography variant="h4" sx={{ fontWeight: 780 }}>机构与账户</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>按机构、账户和项目整理资产；账户仅保存脱敏标识。</Typography></Box><Chip icon={<WalletOutlined />} label="现金使用显式钱包维护" color="primary" variant="outlined" /></Stack>
    {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.85fr 1fr 1.25fr' }, gap: 2, alignItems: 'start' }}>
      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}><PanelHeader title="机构" subtitle={`${institutions.length} 个机构`} onAdd={() => openInstitution()} /><List disablePadding>{institutions.map((item) => <ListItem key={item.id} disablePadding secondaryAction={<Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>{!item.is_active && <Chip label="停用" size="small" />}<IconButton aria-label={`编辑机构 ${item.name}`} size="small" onClick={() => openInstitution(item)}><EditOutlined fontSize="small" /></IconButton></Stack>}><ListItemButton selected={item.id === institutionId} onClick={() => { setSelectedInstitution(item.id); setSelectedAccount(''); }} sx={{ py: 1.5, pr: item.is_active ? 7 : 12, borderBottom: '1px solid', borderColor: 'divider' }}><Box sx={{ width: 34, height: 34, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: item.display_color ?? '#dceae6', color: 'white', mr: 1.5 }}><AccountBalanceOutlined fontSize="small" /></Box><Box sx={{ flex: 1, minWidth: 0 }}><Typography noWrap sx={{ fontSize: 13, fontWeight: 700 }}>{item.name}</Typography><Typography color="text.secondary" sx={{ fontSize: 11 }}>{item.account_count} 个账户 · {item.project_count} 个项目</Typography></Box></ListItemButton></ListItem>)}</List></Paper>
      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}><PanelHeader title="账户" subtitle={institutionId ? `${accounts.length} 个账户` : '请先选择机构'} onAdd={() => openAccount()} disabled={!institutionId} /><List disablePadding>{accounts.map((item) => <ListItem key={item.id} disablePadding secondaryAction={<Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>{!item.is_active && <Chip label="停用" size="small" />}<IconButton aria-label={`编辑账户 ${item.name}`} size="small" onClick={() => openAccount(item)}><EditOutlined fontSize="small" /></IconButton></Stack>}><ListItemButton selected={item.id === accountId} onClick={() => setSelectedAccount(item.id)} sx={{ py: 1.5, pr: item.is_active ? 7 : 12, borderBottom: '1px solid', borderColor: 'divider' }}><WalletOutlined sx={{ color: 'primary.main', mr: 1.5 }} /><Box sx={{ flex: 1, minWidth: 0 }}><Typography noWrap sx={{ fontSize: 13, fontWeight: 700 }}>{item.name}</Typography><Typography color="text.secondary" sx={{ fontSize: 11 }}>{item.masked_identifier || '未设置脱敏标识'} · {item.project_count} 个项目</Typography></Box></ListItemButton></ListItem>)}</List></Paper>
      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}><PanelHeader title="账户内项目" subtitle={accountId ? `${projects.length} 个项目（含停用历史）` : '请先选择账户'} onAdd={() => openProject()} disabled={!accountId} /><List disablePadding>{projects.map((item) => <ListItem key={item.id} secondaryAction={<Stack direction="row" spacing={0.5}><IconButton aria-label={`编辑项目 ${item.name}`} size="small" onClick={() => openProject(item)}><EditOutlined fontSize="small" /></IconButton>{item.is_active && <IconButton aria-label={`停用项目 ${item.name}`} color="warning" size="small" onClick={() => deactivateMutation.mutate(item.id)}><BlockOutlined fontSize="small" /></IconButton>}</Stack>} sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}><Inventory2Outlined sx={{ color: item.is_active ? 'primary.main' : 'text.disabled', mr: 1.5 }} /><Box sx={{ minWidth: 0 }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography noWrap sx={{ fontSize: 13, fontWeight: 700 }}>{item.name}</Typography><Chip size="small" label={item.currency_code} /><Chip size="small" color={item.is_active ? 'success' : 'default'} label={item.is_active ? '启用' : '已停用'} /></Stack><Typography color="text.secondary" noWrap sx={{ fontSize: 11 }}>{item.asset_type} · {item.default_liquidity_level} · {item.default_risk_level}{item.notes ? ` · ${item.notes}` : ''}</Typography></Box></ListItem>)}</List></Paper>
    </Box>

    <Dialog open={Boolean(editor)} onClose={() => setEditor(null)} fullWidth maxWidth="sm">
      <DialogTitle>{editor?.id ? '编辑' : '新增'}{editor?.kind === 'institution' ? '机构' : editor?.kind === 'account' ? '账户' : '项目'}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <TextField label="名称" value={String(editor?.values.name ?? '')} onChange={(event) => setValue('name', event.target.value)} required autoFocus />
        {editor?.kind === 'institution' && <><TextField select label="机构类型" value={String(editor.values.type)} onChange={(event) => setValue('type', event.target.value)}>{institutionTypes.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField><ColorPickerField value={String(editor.values.color)} onChange={(color) => setValue('color', color)} /></>}
        {editor?.kind === 'account' && <><TextField select label="账户类型" value={String(editor.values.type)} onChange={(event) => setValue('type', event.target.value)}>{accountTypes.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField><TextField label="脱敏标识" helperText="仅填写尾号（如：尾号 8888）或自定义简称" value={String(editor.values.identifier)} onChange={(event) => setValue('identifier', event.target.value)} /><ColorPickerField value={String(editor.values.color)} onChange={(color) => setValue('color', color)} /></>}
        {editor?.kind === 'project' && <><TextField select label="资产类型" value={String(editor.values.type)} onChange={(event) => setValue('type', event.target.value)}>{assetTypes.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField><TextField select label="币种" value={String(editor.values.currency)} onChange={(event) => setValue('currency', event.target.value)}>{currencies.map((item) => <MenuItem key={item.code} value={item.code}>{item.code} · {item.name}</MenuItem>)}</TextField><TextField select label="默认流动性" value={String(editor.values.liquidity)} onChange={(event) => setValue('liquidity', event.target.value)}>{liquidityLevels.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField><TextField select label="默认风险" value={String(editor.values.risk)} onChange={(event) => setValue('risk', event.target.value)}>{riskLevels.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField><TextField label="备注" multiline minRows={2} value={String(editor.values.notes)} onChange={(event) => setValue('notes', event.target.value)} /></>}
        <FormControlLabel control={<Switch checked={Boolean(editor?.values.active)} onChange={(event) => setValue('active', event.target.checked)} />} label="启用" />
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setEditor(null)}>取消</Button><Button variant="contained" onClick={() => saveMutation.mutate()} disabled={!String(editor?.values.name ?? '').trim() || saveMutation.isPending}>保存</Button></DialogActions>
    </Dialog>
    <Snackbar open={Boolean(notice)} autoHideDuration={3000} onClose={() => setNotice(null)} message={notice} />
  </Box>;
}
