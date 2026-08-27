import { getSupabaseClient, isSupabaseEnabled } from './supabaseClient';
import type { MessageDocument } from '../utils/messageRichText';
import { assertLiveFranchiseMutationAllowed } from './session';

export type MessageAudienceType = 'broadcast' | 'selected';
export type MessageSenderType = 'franchise' | 'person';

export type MessageRecipient = {
  messageId: string;
  franchiseId: string;
  authUserId: string;
  profileId: string;
  displayName: string;
  email?: string | null;
  role: string;
  messageCreatedAt: string;
  confirmedAt?: string | null;
};

export type MessageRecipientOption = {
  id: string;
  displayName: string;
  email?: string | null;
  role: string;
};

export type FranchiseMessage = {
  id: string;
  franchiseId: string;
  subject: string;
  bodyDocument: MessageDocument;
  bodyPlainText: string;
  audienceType: MessageAudienceType;
  senderType: MessageSenderType;
  senderDisplayName: string;
  authorAuthUserId: string;
  authorProfileId?: string | null;
  authorDisplayName: string;
  authorEmail?: string | null;
  authorRole: string;
  totalRecipientCount: number;
  createdAt: string;
  recipients: MessageRecipient[];
};

export type MessagePage = {
  messages: FranchiseMessage[];
  total: number;
  page: number;
  pageSize: number;
};

export type MessageListFilter = 'all' | 'unread';

export const MESSAGE_STATE_UPDATED_EVENT = 'submerge:message-state-updated';
export const MESSAGING_FEATURE_UNAVAILABLE_MESSAGE =
  'Messages are not available in this environment yet.';

const MESSAGE_BACKEND_IDENTIFIERS = [
  'franchise_messages',
  'franchise_message_recipients',
  'send_franchise_message',
  'confirm_franchise_message',
  'list_franchise_message_recipient_options',
];

const MESSAGE_SELECT = `
  id,
  franchise_id,
  subject,
  body_document,
  body_plain_text,
  audience_type,
  sender_type,
  sender_display_name,
  author_auth_user_id,
  author_profile_id,
  author_display_name,
  author_email,
  author_role,
  total_recipient_count,
  created_at
`;

const RECIPIENT_SELECT = `
  message_id,
  franchise_id,
  recipient_auth_user_id,
  recipient_profile_id,
  recipient_display_name,
  recipient_email,
  recipient_role,
  message_created_at,
  confirmed_at
`;

function requireSupabase() {
  if (!isSupabaseEnabled()) throw new Error(MESSAGING_FEATURE_UNAVAILABLE_MESSAGE);
  const client = getSupabaseClient();
  if (!client) throw new Error(MESSAGING_FEATURE_UNAVAILABLE_MESSAGE);
  return client;
}

async function getCurrentAuthUserId(supabase: ReturnType<typeof requireSupabase>) {
  const { data } = await supabase.auth.getSession();
  const userId = data?.session?.user?.id;
  if (!userId) throw new Error('Authentication is required.');
  return userId;
}

function getErrorText(error: any) {
  return [error?.message, error?.details, error?.hint]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();
}

export function isMessagingFeatureUnavailableError(error: any) {
  if (error instanceof Error && error.message === MESSAGING_FEATURE_UNAVAILABLE_MESSAGE) return true;
  const code = String(error?.code || '').toUpperCase();
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42P01' || code === '42883') return true;
  const text = getErrorText(error);
  return MESSAGE_BACKEND_IDENTIFIERS.some((identifier) => text.includes(identifier)) &&
    (text.includes('does not exist') || text.includes('schema cache'));
}

function normalizeRecipient(row: any): MessageRecipient {
  return {
    messageId: String(row?.message_id || ''),
    franchiseId: String(row?.franchise_id || ''),
    authUserId: String(row?.recipient_auth_user_id || ''),
    profileId: String(row?.recipient_profile_id || ''),
    displayName: String(row?.recipient_display_name || '').trim() || 'User',
    email: row?.recipient_email || null,
    role: String(row?.recipient_role || 'designer').toLowerCase(),
    messageCreatedAt: String(row?.message_created_at || ''),
    confirmedAt: row?.confirmed_at || null,
  };
}

function normalizeMessage(row: any, recipientKey = 'recipients'): FranchiseMessage {
  const recipientValue = row?.[recipientKey];
  const recipientRows = Array.isArray(recipientValue)
    ? recipientValue
    : recipientValue
      ? [recipientValue]
      : [];
  return {
    id: String(row?.id || ''),
    franchiseId: String(row?.franchise_id || ''),
    subject: String(row?.subject || '').trim(),
    bodyDocument: row?.body_document as MessageDocument,
    bodyPlainText: String(row?.body_plain_text || ''),
    audienceType: row?.audience_type === 'broadcast' ? 'broadcast' : 'selected',
    senderType: row?.sender_type === 'franchise' ? 'franchise' : 'person',
    senderDisplayName: String(row?.sender_display_name || '').trim() || 'Unknown Sender',
    authorAuthUserId: String(row?.author_auth_user_id || ''),
    authorProfileId: row?.author_profile_id || null,
    authorDisplayName: String(row?.author_display_name || '').trim() || 'Unknown Author',
    authorEmail: row?.author_email || null,
    authorRole: String(row?.author_role || '').toLowerCase(),
    totalRecipientCount: Math.max(0, Number(row?.total_recipient_count) || recipientRows.length),
    createdAt: String(row?.created_at || ''),
    recipients: recipientRows.map(normalizeRecipient),
  };
}

function normalizePage(page = 1, pageSize = 20) {
  const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize || 20)));
  const safePage = Math.max(1, Math.floor(page || 1));
  return {
    page: safePage,
    pageSize: safePageSize,
    from: (safePage - 1) * safePageSize,
    to: safePage * safePageSize - 1,
  };
}

function getSearchFilter(search?: string | null) {
  const normalized = String(search || '')
    .trim()
    .replace(/[,%()]/g, ' ')
    .replace(/\s+/g, ' ');
  if (!normalized) return null;
  return `subject.ilike.%${normalized}%,sender_display_name.ilike.%${normalized}%,author_display_name.ilike.%${normalized}%`;
}

export async function sendFranchiseMessage(payload: {
  franchiseId: string;
  subject: string;
  bodyDocument: MessageDocument;
  bodyPlainText: string;
  audienceType: MessageAudienceType;
  recipientProfileIds?: string[];
  sendAsFranchise: boolean;
  actingAsOwner?: boolean;
}) {
  assertLiveFranchiseMutationAllowed();
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('send_franchise_message', {
    p_franchise_id: payload.franchiseId,
    p_subject: payload.subject,
    p_body_document: payload.bodyDocument,
    p_body_plain_text: payload.bodyPlainText,
    p_audience_type: payload.audienceType,
    p_recipient_profile_ids: payload.recipientProfileIds || null,
    p_send_as_franchise: payload.sendAsFranchise,
    p_acting_as_owner: payload.actingAsOwner === true,
  });
  if (error) throw error;
  const messageId = String(data || '');
  publishMessageStateUpdated('sent', messageId);
  return messageId;
}

export async function listMessageRecipientOptions(
  franchiseId: string
): Promise<MessageRecipientOption[]> {
  const normalizedFranchiseId = String(franchiseId || '').trim();
  if (!normalizedFranchiseId) return [];

  const supabase = requireSupabase();
  const normalizeOptions = (rows: any[]) => rows
    .map((row: any) => ({
      id: String(row?.recipient_profile_id || row?.id || ''),
      displayName: String(row?.recipient_display_name || row?.name || row?.email || '').trim() || 'User',
      email: row?.recipient_email || row?.email || null,
      role: String(row?.recipient_role || row?.role || 'designer').toLowerCase(),
    }))
    .filter((recipient) => Boolean(recipient.id));

  const { data: rpcData, error: rpcError } = await supabase.rpc('list_franchise_message_recipient_options', {
    p_franchise_id: normalizedFranchiseId,
  });
  const rpcOptions = normalizeOptions(rpcData || []);
  if (!rpcError && rpcOptions.length > 0) return rpcOptions;

  const { data: fallbackData, error: fallbackError } = await supabase
    .from('franchise_users')
    .select('id,name,email,role')
    .eq('franchise_id', normalizedFranchiseId)
    .not('auth_user_id', 'is', null)
    .or('is_active.eq.true,is_active.is.null')
    .in('role', ['owner', 'admin', 'bookkeeper', 'designer'])
    .order('name', { ascending: true });
  if (fallbackError) throw rpcError || fallbackError;
  return normalizeOptions(fallbackData || []);
}

export async function confirmFranchiseMessage(messageId: string) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('confirm_franchise_message', {
    p_message_id: messageId,
  });
  if (error) throw error;
  publishMessageStateUpdated('confirmed', messageId);
  return String(data || '');
}

export async function listPendingMessages(limit = 100) {
  const supabase = requireSupabase();
  const userId = await getCurrentAuthUserId(supabase);
  const { data, count, error } = await supabase
    .from('franchise_messages')
    .select(`${MESSAGE_SELECT}, own_recipient:franchise_message_recipients!inner(${RECIPIENT_SELECT})`, {
      count: 'exact',
    })
    .eq('own_recipient.recipient_auth_user_id', userId)
    .is('own_recipient.confirmed_at', null)
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(100, Math.floor(limit || 100))));
  if (error) throw error;
  return {
    messages: (data || []).map((row: any) => normalizeMessage(row, 'own_recipient')),
    total: count || 0,
  };
}

export async function listPersonalMessages(options: {
  page?: number;
  pageSize?: number;
  filter?: MessageListFilter;
  search?: string;
} = {}): Promise<MessagePage> {
  const supabase = requireSupabase();
  const userId = await getCurrentAuthUserId(supabase);
  const bounds = normalizePage(options.page, options.pageSize);
  let query = supabase
    .from('franchise_messages')
    .select(`${MESSAGE_SELECT}, own_recipient:franchise_message_recipients!inner(${RECIPIENT_SELECT})`, {
      count: 'exact',
    });

  query = query.eq('own_recipient.recipient_auth_user_id', userId);

  if (options.filter === 'unread') query = query.is('own_recipient.confirmed_at', null);
  const searchFilter = getSearchFilter(options.search);
  if (searchFilter) query = query.or(searchFilter);

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(bounds.from, bounds.to);
  if (error) throw error;
  return {
    messages: (data || []).map((row: any) => normalizeMessage(row, 'own_recipient')),
    total: count || 0,
    page: bounds.page,
    pageSize: bounds.pageSize,
  };
}

export async function listSentMessages(options: {
  franchiseId?: string | null;
  authorAuthUserId?: string | null;
  excludeMasterDirect?: boolean;
  audienceType?: MessageAudienceType | null;
  page?: number;
  pageSize?: number;
  search?: string;
} = {}): Promise<MessagePage> {
  const supabase = requireSupabase();
  const bounds = normalizePage(options.page, options.pageSize);
  let query = supabase
    .from('franchise_messages')
    .select(`${MESSAGE_SELECT}, recipients:franchise_message_recipients(${RECIPIENT_SELECT})`, {
      count: 'exact',
    });

  if (options.franchiseId) query = query.eq('franchise_id', options.franchiseId);
  if (options.authorAuthUserId) query = query.eq('author_auth_user_id', options.authorAuthUserId);
  if (options.excludeMasterDirect) query = query.or('author_role.neq.master,audience_type.eq.broadcast');
  if (options.audienceType) query = query.eq('audience_type', options.audienceType);
  const searchFilter = getSearchFilter(options.search);
  if (searchFilter) query = query.or(searchFilter);

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(bounds.from, bounds.to);
  if (error) throw error;
  return {
    messages: (data || []).map((row: any) => normalizeMessage(row)),
    total: count || 0,
    page: bounds.page,
    pageSize: bounds.pageSize,
  };
}

export function publishMessageStateUpdated(reason: 'sent' | 'confirmed', messageId?: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MESSAGE_STATE_UPDATED_EVENT, { detail: { reason, messageId } }));
}
