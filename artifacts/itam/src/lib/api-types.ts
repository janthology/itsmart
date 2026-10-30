/**
 * Shared API/domain types for the app.
 *
 * These were previously imported from the generated `@workspace/api-client-react`
 * package (orval output for the retired REST API). The types were inlined
 * here in Phase 4 — adjusted to the fields the Supabase data layer really
 * returns — so the generated package and the other dead workspaces could
 * be deleted. Nothing at runtime changed; this file is types only.
 */

export type UserRole = "general_user" | "support_staff" | "administrator";

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  department?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  assetTag: string;
  name: string;
  category: string;
  status: string;
  assignedTo?: UserProfile | null;
  purchaseDate?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  // Extended fields returned by the Supabase mapper
  serialNumber?: string | null;
  location?: string | null;
  model?: string | null;
  purchaseValue?: number | null;
  lastPmDate?: string | null;
  nextPmDate?: string | null;
}

export interface AssetListResponse {
  data: Asset[];
  total: number;
  page: number;
  limit: number;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  commentText: string;
  createdBy: UserProfile;
  createdAt: string;
  isSystem?: boolean;
}

export interface Ticket {
  id: string;
  ticketNumber?: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  type?: string;
  asset?: Asset | null;
  createdBy: UserProfile;
  assignedTo?: UserProfile | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  resolvedAt?: string | null;
  lastActivityAt?: string | null;
  satisfactionRating?: number | null;
  satisfactionComment?: string | null;
  totalHoldSeconds?: number;
  onHoldAt?: string | null;
}

export type TicketWithComments = Ticket & {
  comments: TicketComment[];
};

export interface TicketListResponse {
  data: Ticket[];
  total: number;
  page: number;
  limit: number;
}

export interface DashboardStats {
  totalAssets: number;
  assignedAssets: number;
  availableAssets: number;
  inactiveAssets: number;
  inMaintenanceAssets: number;
  retiredAssets: number;
  openTickets: number;
  inProgressTickets: number;
  resolvedTickets: number;
  closedTickets: number;
  resolvedClosedTickets: number;
  totalTickets: number;
  allTickets: number;
  allOpenTickets: number;
  myAssignedAssets: number;
  totalUsers: number;
  recentTickets: Ticket[];
  recentAssets: Asset[];
}

export interface CreateAssetRequest {
  assetTag: string;
  name: string;
  category: string;
  status: string;
  assignedToId?: string | null;
  purchaseDate?: string | null;
  notes?: string | null;
}

export interface UpdateAssetRequest {
  name?: string;
  category?: string;
  status?: string;
  assignedToId?: string | null;
  purchaseDate?: string | null;
  notes?: string | null;
}

export interface CreateTicketRequest {
  title: string;
  description: string;
  priority: string;
  type?: string;
  assetId?: string | null;
}

export interface UpdateTicketRequest {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  type?: string;
  assignedToId?: string | null;
}

export interface CreateCommentRequest {
  commentText: string;
}

export interface UpdateUserRequest {
  fullName?: string;
  role?: UserRole;
  department?: string | null;
}

export interface UpdateProfileRequest {
  fullName?: string;
  department?: string | null;
}
