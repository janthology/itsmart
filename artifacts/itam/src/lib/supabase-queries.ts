/**
 * Supabase data layer — barrel module.
 *
 * Implementation lives in ./queries/ (split in Phase 4):
 *   shared.ts       enums, mappers, session gate, lifecycle + paging helpers
 *   auth.ts         current-user profile
 *   assets.ts       assets CRUD, history, anomalies, tag gen, maintenance log
 *   tickets.ts      tickets list/summary/detail/mutations, satisfaction
 *   users.ts        users & staff directory
 *   dashboard.ts    dashboard stats, staff workload, ticket trend
 *   reports-data.ts report feeds (history, user activity, ticket export)
 *
 * FK constraint names match the actual schema:
 *   assets_assigned_to_fkey
 *   tickets_created_by_fkey
 *   tickets_assigned_to_fkey
 *   ticket_comments_created_by_fkey
 */
export * from './queries/shared';
export * from './queries/auth';
export * from './queries/assets';
export * from './queries/tickets';
export * from './queries/users';
export * from './queries/dashboard';
export * from './queries/reports-data';
export type { UserProfile, Asset, Ticket, TicketWithComments, DashboardStats } from './api-types';
