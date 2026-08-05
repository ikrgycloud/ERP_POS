import { Reports } from '../../lib/api';
import { posQueryKeys } from '../../app/queryKeys';
import { emptyFeatureComponents, useFeatureQuery } from '../shared';

export const dashboardApi = {
  bm: Reports.bmDashboard,
  sm: Reports.smDashboard,
  sp: Reports.spDashboard,
};
export const dashboardKeys = posQueryKeys.dashboard;
export const dashboardQueries = {
  role: (role, options = {}) => ({
    queryKey: dashboardKeys.auxiliary(role || 'current', options.scope),
    queryFn: ({ signal }) => {
      const fn = role === 'sales_manager' ? dashboardApi.sm : role === 'sales_person' ? dashboardApi.sp : dashboardApi.bm;
      return fn({ ...(options.request || {}), signal });
    },
    enabled: options.enabled ?? true,
  }),
};
export const dashboardMutations = {};
export const dashboardHooks = {
  useRoleDashboard: (role, options) => useFeatureQuery(dashboardQueries.role(role, options)),
};
export const dashboardComponents = emptyFeatureComponents;
