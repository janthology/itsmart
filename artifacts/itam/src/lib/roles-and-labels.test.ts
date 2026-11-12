import { describe, expect, it } from 'vitest';
import { buildDashboardMetrics } from '../components/dashboard/metric-cards';
import { applyUserFilter } from '../components/users/user-summary-strip';
import { humanizeLabel, roleLabel } from './labels';

describe('role-based dashboard metrics', () => {
  const stats = { totalAssets: 9, availableAssets: 4, inactiveAssets: 2, myAssignedAssets: 1, totalTickets: 5, allTickets: 20, allOpenTickets: 12, openTickets: 3, inProgressTickets: 2, resolvedTickets: 1, closedTickets: 1 };
  it('shows organization-wide inventory and ticket links to administrators', () => {
    const metrics = buildDashboardMetrics(stats, 'administrator');
    expect(metrics.find(m => m.title === 'All tickets')).toMatchObject({ value: 20, href: '/tickets?scope=all' });
    expect(metrics.find(m => m.title === 'Total assets')).toMatchObject({ value: 9, href: '/assets?scope=all' });
  });
  it('shows organization-wide open tickets and personal work for support', () => {
    const metrics = buildDashboardMetrics(stats, 'support_staff');
    expect(metrics.find(m => m.title === 'Open tickets')).toMatchObject({ value: 12, href: '/tickets?status=open&scope=all' });
    expect(metrics.find(m => m.title === 'My tickets')).toMatchObject({ value: 5, href: '/tickets?scope=mine' });
  });
  it('keeps general-user cards scoped to their own records', () => {
    const metrics = buildDashboardMetrics(stats, 'general_user');
    expect(metrics.find(m => m.title === 'Open')).toMatchObject({ value: 3, href: '/tickets?status=open&scope=mine' });
    expect(metrics.find(m => m.title === 'My tickets')).toMatchObject({ value: 5, href: '/tickets?scope=mine' });
    expect(metrics.some(m => m.title === 'Total assets')).toBe(false);
  });
});

describe('user filters and labels', () => {
  const users = [{ role: 'administrator', isActive: true }, { role: 'support_staff', isActive: false }, { role: 'general_user', isActive: true }];
  it('filters inactive users independently of their role', () => {
    expect(applyUserFilter(users, 'inactive')).toEqual([users[1]]);
    expect(applyUserFilter(users, 'support_staff')).toEqual([users[1]]);
    expect(applyUserFilter(users, 'all')).toEqual(users);
  });
  it('formats known and unknown roles for display', () => {
    expect(roleLabel('support_staff')).toBe('Support Staff');
    expect(roleLabel('external_staff')).toBe('External Staff');
    expect(humanizeLabel('in_progress')).toBe('In Progress');
  });
});
