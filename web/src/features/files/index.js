import { useMutation, useQueryClient } from "@tanstack/react-query";
import { erpQueryKeys } from "../../app/queryKeys";
import { api } from "../../services/api";
import { createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const filesApi = {
  list: api.getFiles,
  upload: api.uploadFile,
  submitProducts: api.submitFileProducts,
  remove: api.deleteFile,
};

export const filesKeys = erpQueryKeys.files;
export const filesQueries = createFeatureQueries(filesKeys, filesApi);

function invalidateFiles(queryClient) {
  queryClient.invalidateQueries({ queryKey: filesKeys.root });
}

function invalidateFileImport(queryClient) {
  invalidateFiles(queryClient);
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.products.root });
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.inventory.root });
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.suppliers.root });
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.categories.root });
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.dashboard.root });
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.reports.root });
}

export function useFiles(options) {
  return useFeatureQuery(filesQueries.list(undefined, options));
}

export function useUploadFile(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables) => filesApi.upload(variables?.file ?? variables),
    onSuccess: (...args) => {
      invalidateFiles(queryClient);
      options.onSuccess?.(...args);
    },
  });
}

export function useSubmitFileProducts(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables) =>
      filesApi.submitProducts(variables.id, variables.rows, variables.idempotencyKey),
    onSuccess: (...args) => {
      invalidateFileImport(queryClient);
      options.onSuccess?.(...args);
    },
  });
}

export function useDeleteFile(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables) => filesApi.remove(variables?.id ?? variables),
    onSuccess: (...args) => {
      invalidateFiles(queryClient);
      options.onSuccess?.(...args);
    },
  });
}

export const filesHooks = {
  useList: useFiles,
  useUpload: useUploadFile,
  useSubmitProducts: useSubmitFileProducts,
  useRemove: useDeleteFile,
};

export const filesComponents = emptyFeatureComponents;
