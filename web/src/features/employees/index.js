import { BusinessEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const employeesApi = {
  list: BusinessEndpoints.outlets,
};
export const employeesKeys = erpQueryKeys.employees;
export const employeesQueries = createFeatureQueries(employeesKeys, employeesApi);
export const employeesMutations = {};
export const employeesHooks = {
  useOutletStaffSource: (profileId, options) => useFeatureQuery({
    queryKey: employeesKeys.auxiliary("outlets", options?.scope, { profileId }),
    queryFn: ({ signal }) => employeesApi.list(profileId, { ...(options?.request || {}), signal }),
    enabled: options?.enabled ?? profileId != null,
  }),
};
export const employeesComponents = emptyFeatureComponents;
