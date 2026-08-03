import { BusinessEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureMutations, createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const settingsApi = {
  list: BusinessEndpoints.profile,
  update: BusinessEndpoints.saveProfile,
};
export const settingsKeys = erpQueryKeys.settings;
export const settingsQueries = createFeatureQueries(settingsKeys, settingsApi);
export const settingsMutations = createFeatureMutations(settingsKeys, settingsApi);
export const settingsHooks = {
  useSettings: (filters, options) => useFeatureQuery(settingsQueries.list(filters, options)),
  useUpdate: settingsMutations.useUpdate,
};
export const settingsComponents = emptyFeatureComponents;
