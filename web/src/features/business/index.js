import { useMutation, useQueryClient } from "@tanstack/react-query";
import { erpQueryKeys } from "../../app/queryKeys";
import { BusinessEndpoints } from "../../services/api";
import { createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const businessApi = BusinessEndpoints;
export const businessKeys = erpQueryKeys.business;
export const outletsKeys = erpQueryKeys.outlets;

export const businessQueries = {
  profile: (options = {}) => ({
    queryKey: businessKeys.detail(options.scope, "profile"),
    queryFn: ({ signal }) => businessApi.profile({ ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
    staleTime: options.staleTime,
    placeholderData: options.placeholderData,
  }),
  outlets: (profileId, options = {}) => ({
    queryKey: outletsKeys.list(options.scope, { profileId }),
    queryFn: ({ signal }) => businessApi.outlets(profileId, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? Boolean(profileId),
    staleTime: options.staleTime,
    placeholderData: options.placeholderData,
  }),
};

export const outletsQueries = createFeatureQueries(outletsKeys, {
  list: (_filters, options) => businessApi.outlets(options.profileId, options),
});

function invalidateBusiness(queryClient) {
  queryClient.invalidateQueries({ queryKey: businessKeys.root });
  queryClient.invalidateQueries({ queryKey: outletsKeys.root });
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.dashboard.root });
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.reports.root });
}

export function useBusinessProfile(options) {
  return useFeatureQuery(businessQueries.profile(options));
}

export function useOutlets(profileId, options) {
  return useFeatureQuery(businessQueries.outlets(profileId, options));
}

export function useSaveBusinessProfile(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables) => businessApi.saveProfile(variables?.payload ?? variables, options.request),
    onSuccess: (...args) => {
      invalidateBusiness(queryClient);
      options.onSuccess?.(...args);
    },
  });
}

export function useUploadBusinessLogo(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables) => businessApi.uploadLogo(variables.profileId, variables.logoAsset),
    onSuccess: (...args) => {
      invalidateBusiness(queryClient);
      options.onSuccess?.(...args);
    },
  });
}

export function useCreateOutlet(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables) => businessApi.createOutlet(variables.profileId, variables.payload, options.request),
    onSuccess: (...args) => {
      invalidateBusiness(queryClient);
      options.onSuccess?.(...args);
    },
  });
}

export function useUpdateOutlet(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables) => businessApi.updateOutlet(variables.profileId, variables.outletId, variables.payload, options.request),
    onSuccess: (...args) => {
      invalidateBusiness(queryClient);
      options.onSuccess?.(...args);
    },
  });
}

export function useDeleteOutlet(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables) => businessApi.deleteOutlet(variables.profileId, variables.outletId, options.request),
    onSuccess: (...args) => {
      invalidateBusiness(queryClient);
      options.onSuccess?.(...args);
    },
  });
}

export const businessHooks = {
  useProfile: useBusinessProfile,
  useOutlets,
  useSaveProfile: useSaveBusinessProfile,
  useUploadLogo: useUploadBusinessLogo,
  useCreateOutlet,
  useUpdateOutlet,
  useDeleteOutlet,
};

export const businessComponents = emptyFeatureComponents;
