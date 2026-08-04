import type { Proposal, ProposalWorkflowActor } from '../types/proposal-new';
import { getSupabaseClient } from './supabaseClient';
import { getSessionFranchiseCode, getSessionFranchiseId } from './session';
import {
  getBundledContractTemplateRevision,
  getContractTemplate,
  getContractTemplateIdForProposal,
  listBundledContractTemplates,
  type ContractTemplate,
  type ContractTemplateId,
  type TemplateField,
} from './contractTemplates';

const CONTRACT_BUCKET = 'franchise-contract-templates';
const CONTRACT_CACHE = 'submerge-contract-template-revisions-v1';

export type ContractRevisionDescriptor = {
  templateId: string;
  templateName: string;
  revisionId: string;
  revisionNumber: number;
  franchiseId: string;
  jurisdictionKey: string;
  poolType: 'shotcrete' | 'fiberglass';
  originalFileName: string;
  publishedAt?: string | null;
  publishedBy?: string | null;
  source: 'bundled' | 'remote';
  contractTemplate: ContractTemplate;
};

export type ContractRevisionCheck = {
  pinned: ContractRevisionDescriptor;
  latest: ContractRevisionDescriptor;
  requiresReview: boolean;
  canAdoptInitialRevisionSilently: boolean;
};

export type ContractTemplateSummary = {
  id: string;
  franchise_id: string;
  name: string;
  jurisdiction_key: string;
  pool_type: 'shotcrete' | 'fiberglass';
  current_revision_id?: string | null;
};

type RemoteTemplateRow = ContractTemplateSummary;

type RemoteRevisionRow = {
  id: string;
  contract_template_id: string;
  franchise_id: string;
  revision_number: number;
  storage_path: string;
  original_file_name: string;
  field_layout_json?: unknown;
  published_at?: string | null;
  published_by?: string | null;
};

const schemaUnavailable = (error: any) => {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || message.includes('does not exist') || message.includes('schema cache');
};

const normalizePoolType = (proposal: Proposal): 'shotcrete' | 'fiberglass' =>
  proposal.poolSpecs?.poolType === 'fiberglass' ? 'fiberglass' : 'shotcrete';

const normalizeJurisdiction = (proposal: Proposal) =>
  String(proposal.customerInfo?.state || '*').trim().toUpperCase() || '*';

function bundledRevision(
  franchiseId: string,
  proposal: Proposal,
  revisionNumber?: number | null
): ContractRevisionDescriptor | null {
  const localId = getContractTemplateIdForProposal(proposal);
  const bundled = getBundledContractTemplateRevision(localId, revisionNumber);
  if (!bundled) return null;
  const template = bundled.contractTemplate;
  return {
    templateId: `bundled:${franchiseId}:${localId}`,
    templateName: template.label,
    revisionId: `bundled:${franchiseId}:${localId}:r${bundled.revisionNumber}`,
    revisionNumber: bundled.revisionNumber,
    franchiseId,
    jurisdictionKey: normalizeJurisdiction(proposal),
    poolType: normalizePoolType(proposal),
    originalFileName: template.label + '.pdf',
    publishedAt: bundled.publishedAt,
    source: 'bundled',
    contractTemplate: template,
  };
}

function getBundledRevisionNumber(revisionId: string, franchiseId: string, localId: ContractTemplateId) {
  const prefix = `bundled:${franchiseId}:${localId}:r`;
  if (!revisionId.startsWith(prefix)) return null;
  const parsed = Number(revisionId.slice(prefix.length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function bundledRevisionFromId(franchiseId: string, proposal: Proposal, revisionId: string) {
  const localId = getContractTemplateIdForProposal(proposal);
  const revisionNumber = getBundledRevisionNumber(revisionId, franchiseId, localId);
  return revisionNumber === null ? null : bundledRevision(franchiseId, proposal, revisionNumber);
}

async function isWestFranchise(franchiseId: string) {
  if (getSessionFranchiseId() === franchiseId) {
    return getSessionFranchiseCode() === '5555';
  }
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('franchises')
    .select('franchise_code')
    .eq('id', franchiseId)
    .maybeSingle();
  if (error) return false;
  return String(data?.franchise_code || '').trim() === '5555';
}

function cacheRequestForRevision(revisionId: string) {
  return new Request(`https://contract-cache.submerge.local/${encodeURIComponent(revisionId)}`);
}

async function loadRemotePdfUrl(revision: RemoteRevisionRow): Promise<string> {
  const cacheAvailable = typeof caches !== 'undefined';
  const cache = cacheAvailable ? await caches.open(CONTRACT_CACHE) : null;
  const cacheRequest = cacheRequestForRevision(revision.id);
  const supabase = getSupabaseClient();

  if (supabase && typeof navigator !== 'undefined' && navigator.onLine !== false) {
    try {
      const { data, error } = await supabase.storage
        .from(CONTRACT_BUCKET)
        .createSignedUrl(revision.storage_path, 3600);
      if (error || !data?.signedUrl) throw error || new Error('No signed contract URL was returned.');
      const response = await fetch(data.signedUrl);
      if (!response.ok) throw new Error(`Contract download failed (${response.status}).`);
      if (cache) await cache.put(cacheRequest, response.clone());
      return URL.createObjectURL(await response.blob());
    } catch (error) {
      console.warn('Unable to refresh remote contract template; checking local cache.', error);
    }
  }

  const cached = cache ? await cache.match(cacheRequest) : null;
  if (cached) return URL.createObjectURL(await cached.blob());
  throw new Error('This contract revision is not cached on this device. Connect to the internet and open it once.');
}

function validFields(input: unknown): TemplateField[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const fields = input.filter((field: any) =>
    field &&
    typeof field.id === 'string' &&
    Number.isFinite(field.page) &&
    Array.isArray(field.rect) &&
    field.rect.length === 4
  ) as TemplateField[];
  return fields.length ? fields : null;
}

async function descriptorFromRemote(
  templateRow: RemoteTemplateRow,
  revisionRow: RemoteRevisionRow,
  proposal: Proposal
): Promise<ContractRevisionDescriptor> {
  const fallback = getContractTemplate(getContractTemplateIdForProposal(proposal));
  const pdfUrl = await loadRemotePdfUrl(revisionRow);
  return {
    templateId: templateRow.id,
    templateName: templateRow.name,
    revisionId: revisionRow.id,
    revisionNumber: revisionRow.revision_number,
    franchiseId: templateRow.franchise_id,
    jurisdictionKey: templateRow.jurisdiction_key,
    poolType: templateRow.pool_type,
    originalFileName: revisionRow.original_file_name,
    publishedAt: revisionRow.published_at,
    publishedBy: revisionRow.published_by,
    source: 'remote',
    contractTemplate: {
      ...fallback,
      id: templateRow.id,
      label: templateRow.name,
      pdfUrl,
      pdfPath: '',
      fields: validFields(revisionRow.field_layout_json) || fallback.fields,
    },
  };
}

async function loadRemoteCurrent(proposal: Proposal): Promise<ContractRevisionDescriptor | null> {
  const franchiseId = proposal.franchiseId;
  if (!franchiseId) return null;
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const poolType = normalizePoolType(proposal);
  const jurisdiction = normalizeJurisdiction(proposal);
  const { data: rows, error } = await supabase
    .from('franchise_contract_templates')
    .select('id,franchise_id,name,jurisdiction_key,pool_type,current_revision_id')
    .eq('franchise_id', franchiseId)
    .eq('pool_type', poolType)
    .eq('is_active', true);
  if (error) {
    if (schemaUnavailable(error)) return null;
    throw error;
  }
  const templateRow = ((rows || []) as RemoteTemplateRow[]).find(
    (row) => String(row.jurisdiction_key || '*').toUpperCase() === jurisdiction
  ) || ((rows || []) as RemoteTemplateRow[]).find((row) => row.jurisdiction_key === '*');
  if (!templateRow?.current_revision_id) return null;
  const { data: revision, error: revisionError } = await supabase
    .from('franchise_contract_template_revisions')
    .select('id,contract_template_id,franchise_id,revision_number,storage_path,original_file_name,field_layout_json,published_at,published_by')
    .eq('id', templateRow.current_revision_id)
    .maybeSingle();
  if (revisionError) throw revisionError;
  return revision ? descriptorFromRemote(templateRow, revision as RemoteRevisionRow, proposal) : null;
}

async function loadRemoteRevision(proposal: Proposal, revisionId: string): Promise<ContractRevisionDescriptor | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data: revision, error } = await supabase
    .from('franchise_contract_template_revisions')
    .select('id,contract_template_id,franchise_id,revision_number,storage_path,original_file_name,field_layout_json,published_at,published_by')
    .eq('id', revisionId)
    .maybeSingle();
  if (error) {
    if (schemaUnavailable(error)) return null;
    throw error;
  }
  if (!revision) return null;
  const { data: template, error: templateError } = await supabase
    .from('franchise_contract_templates')
    .select('id,franchise_id,name,jurisdiction_key,pool_type,current_revision_id')
    .eq('id', revision.contract_template_id)
    .maybeSingle();
  if (templateError) throw templateError;
  return template ? descriptorFromRemote(template as RemoteTemplateRow, revision as RemoteRevisionRow, proposal) : null;
}

export async function checkProposalContractRevision(proposal: Proposal): Promise<ContractRevisionCheck | null> {
  if (!proposal.franchiseId) return null;
  const latestRemote = await loadRemoteCurrent(proposal);
  const supportsBundled = await isWestFranchise(proposal.franchiseId);
  if (!latestRemote && !supportsBundled) return null;
  const latestBundled = supportsBundled ? bundledRevision(proposal.franchiseId, proposal) : null;
  const initialBundled = supportsBundled ? bundledRevision(proposal.franchiseId, proposal, 1) : null;
  const pinned = proposal.contractTemplateRevisionId
    ? proposal.contractTemplateRevisionId.startsWith('bundled:')
      ? bundledRevisionFromId(proposal.franchiseId, proposal, proposal.contractTemplateRevisionId)
      : await loadRemoteRevision(proposal, proposal.contractTemplateRevisionId)
    : initialBundled || latestRemote;
  const latest = latestRemote || latestBundled;
  if (!pinned || !latest) return null;
  if (pinned.franchiseId !== proposal.franchiseId || latest.franchiseId !== proposal.franchiseId) {
    throw new Error('The selected contract revision does not belong to this proposal franchise.');
  }
  const changed = pinned.revisionId !== latest.revisionId;
  const proposalCreatedAt = Date.parse(String(proposal.createdDate || ''));
  const latestPublishedAt = Date.parse(String(latest.publishedAt || ''));
  const proposalWasCreatedAfterLatestPublication =
    Number.isFinite(proposalCreatedAt) &&
    Number.isFinite(latestPublishedAt) &&
    proposalCreatedAt >= latestPublishedAt;
  const silentInitial =
    !proposal.contractTemplateRevisionId &&
    ((latest.source === 'remote' && latest.revisionNumber === 1) || proposalWasCreatedAfterLatestPublication);
  return {
    pinned,
    latest,
    requiresReview: changed && !silentInitial,
    canAdoptInitialRevisionSilently: silentInitial,
  };
}

export function adoptContractRevision(
  proposal: Proposal,
  revision: ContractRevisionDescriptor,
  actor?: ProposalWorkflowActor | null
): Proposal {
  return {
    ...proposal,
    contractTemplateId: revision.templateId,
    contractTemplateRevisionId: revision.revisionId,
    contractTemplateRevisionNumber: revision.revisionNumber,
    contractRevisionReview: {
      latestRevisionId: revision.revisionId,
      latestRevisionNumber: revision.revisionNumber,
      decision: 'upgraded',
      detectedAt: proposal.contractRevisionReview?.detectedAt || new Date().toISOString(),
      decidedAt: new Date().toISOString(),
      decidedBy: actor || null,
    },
  };
}

export function declineContractRevision(
  proposal: Proposal,
  pinned: ContractRevisionDescriptor,
  latest: ContractRevisionDescriptor,
  actor?: ProposalWorkflowActor | null
): Proposal {
  return {
    ...proposal,
    contractTemplateId: pinned.templateId,
    contractTemplateRevisionId: pinned.revisionId,
    contractTemplateRevisionNumber: pinned.revisionNumber,
    contractRevisionReview: {
      latestRevisionId: latest.revisionId,
      latestRevisionNumber: latest.revisionNumber,
      decision: 'declined',
      detectedAt: proposal.contractRevisionReview?.detectedAt || new Date().toISOString(),
      decidedAt: new Date().toISOString(),
      decidedBy: actor || null,
    },
  };
}

export async function listContractTemplatesForFranchise(franchiseId: string, franchiseCode?: string | null) {
  const supabase = getSupabaseClient();
  let remoteTemplates: RemoteTemplateRow[] = [];
  if (supabase) {
    const { data, error } = await supabase
      .from('franchise_contract_templates')
      .select('id,franchise_id,name,jurisdiction_key,pool_type,current_revision_id')
      .eq('franchise_id', franchiseId)
      .eq('is_active', true)
      .order('name');
    if (!error && data?.length) remoteTemplates = data as RemoteTemplateRow[];
    if (error && !schemaUnavailable(error)) throw error;
  }
  if (String(franchiseCode || '').trim() !== '5555') return remoteTemplates;
  const bundledTemplates = listBundledContractTemplates().map((template) => {
    const latestRevision = getBundledContractTemplateRevision(template.id as ContractTemplateId);
    return {
      id: `bundled:${franchiseId}:${template.id}`,
      franchise_id: franchiseId,
      name: template.label,
      jurisdiction_key: template.id.startsWith('sc-') ? 'SC' : 'NC',
      pool_type: template.id.endsWith('fiberglass') ? 'fiberglass' : 'shotcrete',
      current_revision_id: `bundled:${franchiseId}:${template.id}:r${latestRevision?.revisionNumber || 1}`,
    };
  }) as RemoteTemplateRow[];
  const remoteResolutionKeys = new Set(
    remoteTemplates.map((template) =>
      `${String(template.jurisdiction_key || '*').toUpperCase()}:${template.pool_type}`
    )
  );
  return [
    ...remoteTemplates,
    ...bundledTemplates.filter((template) =>
      !remoteResolutionKeys.has(`${template.jurisdiction_key.toUpperCase()}:${template.pool_type}`)
    ),
  ].sort((left, right) => left.name.localeCompare(right.name));
}

export function getBundledTemplateForRegistryId(templateId: string): ContractTemplate | null {
  const segments = templateId.split(':');
  const localId = segments[segments.length - 1] as ContractTemplateId | undefined;
  if (!localId) return null;
  return getBundledContractTemplateRevision(localId)?.contractTemplate || null;
}

export async function loadContractTemplatePreview(
  template: ContractTemplateSummary
): Promise<{ name: string; revisionNumber: number; pdfUrl: string }> {
  if (template.id.startsWith('bundled:')) {
    const segments = template.id.split(':');
    const localId = segments[segments.length - 1] as ContractTemplateId | undefined;
    const bundled = localId ? getBundledContractTemplateRevision(localId) : null;
    if (!bundled) throw new Error('Bundled contract template was not found.');
    return {
      name: template.name,
      revisionNumber: bundled.revisionNumber,
      pdfUrl: bundled.contractTemplate.pdfUrl,
    };
  }
  if (!template.current_revision_id) throw new Error('This contract template does not have a published revision.');
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Connect to Supabase to load this contract template.');
  const { data, error } = await supabase
    .from('franchise_contract_template_revisions')
    .select('id,contract_template_id,franchise_id,revision_number,storage_path,original_file_name,field_layout_json,published_at,published_by')
    .eq('id', template.current_revision_id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('The published contract revision could not be found.');
  return {
    name: template.name,
    revisionNumber: data.revision_number,
    pdfUrl: await loadRemotePdfUrl(data as RemoteRevisionRow),
  };
}
