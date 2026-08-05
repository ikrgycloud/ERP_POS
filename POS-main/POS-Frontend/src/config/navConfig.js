import { ROLES } from '../lib/auth';

export const NAV_CONFIG = [
  // Sales Person
  { to: '/billing', label: 'Billing', glyph: '▤', roles: [ROLES.SP] },
  // Common
  { to: '/returns', label: 'Returns', glyph: '↺', roles: [ROLES.BM, ROLES.SM, ROLES.SP] },
  { to: '/products', label: 'Products', glyph: '◫', roles: [ROLES.BM, ROLES.SM, ROLES.SP] },
  { to: '/invoices', label: 'Invoices', glyph: '⎘', roles: [ROLES.BM, ROLES.SM, ROLES.SP] },
  // Sales Manager / Branch Manager
  { to: '/team', label: 'Team', glyph: '♙', roles: [ROLES.BM, ROLES.SM] },
  
  // Reports and dashboards
  { to: '/dashboard', label: 'Reports', glyph: '◪', roles: [ROLES.BM, ROLES.SM, ROLES.SP] },
  { to: '/return-reports', label: 'Return BI', glyph: '▥', roles: [ROLES.BM, ROLES.SM] },
  { to: '/settings', label: 'Settings', glyph: '⚙', roles: [ROLES.BM, ROLES.SM, ROLES.SP] },
];
