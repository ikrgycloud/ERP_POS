import React, { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { AppButton } from "../components/AppButton";
import { useModal } from "../components/ModalProvider";
import { ScreenHeader } from "../components/ScreenHeader";
import { colors, radii, spacing, typography } from "../constants/theme";
import { createRequestKey } from "../services/api";

const REQUIRED_NAME_KEYS = new Set([
  "product",
  "productname",
  "item",
  "itemname",
  "name",
  "description",
  "descriptionofgoods",
  "material",
]);
const QUANTITY_KEYS = new Set([
  "quantity",
  "qty",
  "stock",
  "newstock",
  "newqty",
  "qtybought",
  "boughtqty",
  "boughtquantity",
  "availableqty",
]);
const MONEY_KEYS = new Set([
  "mrp",
  "maximumretailprice",
  "buyprice",
  "purchaseprice",
  "costprice",
  "cost",
  "sellprice",
  "sellingprice",
  "saleprice",
  "price",
  "rate",
]);
const GST_KEYS = new Set(["gst", "gstrate", "tax", "taxrate"]);
const ID_KEYS = new Set([
  "sku",
  "code",
  "productcode",
  "itemcode",
  "barcode",
  "barcodeno",
  "barcodenumber",
  "ean",
  "upc",
]);

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getRowValue(row, keySet) {
  for (const [key, value] of Object.entries(row || {})) {
    if (keySet.has(normalizeKey(key)) && String(value || "").trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function parseNumber(value) {
  const normalized = String(value || "")
    .replace(/[,₹]/g, "")
    .trim();
  if (!normalized) {
    return null;
  }
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function validateRows(rows) {
  const duplicateIds = new Set();
  const seenIds = new Set();
  rows.forEach((row) => {
    const idValue = getRowValue(row, ID_KEYS).toLowerCase();
    if (!idValue) {
      return;
    }
    if (seenIds.has(idValue)) {
      duplicateIds.add(idValue);
    }
    seenIds.add(idValue);
  });

  return rows.map((row) => {
    const issues = [];
    const productName = getRowValue(row, REQUIRED_NAME_KEYS);
    const quantity = getRowValue(row, QUANTITY_KEYS);
    const gst = getRowValue(row, GST_KEYS);
    const idValue = getRowValue(row, ID_KEYS).toLowerCase();

    if (!productName) {
      issues.push("Product name is required");
    }
    if (quantity && parseNumber(quantity) === null) {
      issues.push("Quantity must be a number");
    }
    if (gst) {
      const gstValue = parseNumber(gst);
      if (gstValue === null || gstValue < 0 || gstValue > 100) {
        issues.push("GST must be between 0 and 100");
      }
    }
    Object.entries(row || {}).forEach(([key, value]) => {
      if (
        MONEY_KEYS.has(normalizeKey(key)) &&
        String(value || "").trim() &&
        parseNumber(value) === null
      ) {
        issues.push(`${key} must be a number`);
      }
    });
    if (idValue && duplicateIds.has(idValue)) {
      issues.push("Duplicate SKU/barcode in preview");
    }
    return issues;
  });
}

export function FilesScreen({
  files = [],
  isBusy = false,
  onDeleteFile,
  onSubmitProducts,
  onUploadFile,
}) {
  const modal = useModal();
  const inputRef = useRef(null);
  const [selectedFileId, setSelectedFileId] = useState(files[0]?.id || null);
  const [isEditing, setIsEditing] = useState(false);
  const [hasEditedRows, setHasEditedRows] = useState(false);
  const [editableRows, setEditableRows] = useState([]);
  const [importResult, setImportResult] = useState(null);
  const [statusText, setStatusText] = useState("");
  const selectedFile =
    files.find((item) => item.id === selectedFileId) || files[0] || null;
  const rowIssues = validateRows(editableRows);
  const issueCount = rowIssues.reduce(
    (total, issues) => total + (issues.length ? 1 : 0),
    0,
  );
  const readyRows = Math.max(0, editableRows.length - issueCount);
  const canSubmit = Boolean(
    selectedFile && editableRows.length && !issueCount && !isBusy,
  );
  const fileStatus = importResult
    ? "Imported"
    : hasEditedRows
      ? "Edited"
      : selectedFile
        ? "Ready"
        : "No file";

  useEffect(() => {
    if (!selectedFileId && files[0]?.id) {
      setSelectedFileId(files[0].id);
    }
  }, [files, selectedFileId]);

  useEffect(() => {
    setEditableRows(
      (selectedFile?.previewRows || []).map((row) => ({ ...row })),
    );
    setIsEditing(false);
    setHasEditedRows(false);
    setImportResult(null);
  }, [selectedFile?.id]);

  const pickFile = () => {
    inputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xls", "xlsx"].includes(extension)) {
      setStatusText("Only CSV, XLS, and XLSX files are allowed.");
      return;
    }
    try {
      setStatusText("Uploading and extracting file...");
      const uploaded = await onUploadFile(file);
      setSelectedFileId(uploaded?.id || null);
      setStatusText(
        `Extracted ${uploaded?.rowCount || 0} rows from ${uploaded?.originalName || "file"}. Review the preview, then submit to import every row.`,
      );
      await modal.success(
        "File uploaded successfully",
        `${uploaded?.rowCount || 0} rows extracted.`,
      );
    } catch (error) {
      setStatusText(error?.message || "File upload failed. Please try again.");
    }
  };

  const updateCell = (rowIndex, column, value) => {
    setHasEditedRows(true);
    setEditableRows((current) =>
      current.map((row, index) =>
        index === rowIndex ? { ...row, [column]: value } : row,
      ),
    );
  };

  const submitProducts = async () => {
    if (!selectedFile) {
      return;
    }
    if (!editableRows.length) {
      setStatusText("No preview rows are available to submit.");
      return;
    }
    if (issueCount) {
      setStatusText(
        `Fix ${issueCount} row issue${issueCount === 1 ? "" : "s"} before importing products.`,
      );
      return;
    }
    try {
      setStatusText(
        `Importing all ${selectedFile.rowCount || editableRows.length} rows into inventory...`,
      );
      const result = await onSubmitProducts(
        selectedFile.id,
        hasEditedRows ? editableRows : null,
        createRequestKey("file-import"),
      );
      setImportResult(result);
      setIsEditing(false);
      setStatusText(
        `Import complete: ${result?.created || 0} created, ${result?.updated || 0} updated, ${result?.skipped || 0} skipped.`,
      );
      await modal.success(
        "Products imported successfully",
        `${result?.created || 0} created, ${result?.updated || 0} updated, ${result?.skipped || 0} skipped.`,
      );
    } catch (error) {
      const message =
        error?.message ||
        "Product import failed. Please upload the file again.";
      setStatusText(message);
      setImportResult({
        created: 0,
        updated: 0,
        skipped: 0,
        messages: [
          message,
          message.toLowerCase().includes("source file is missing")
            ? "This is an old upload record. Delete this file row, upload the CSV again, then click Submit."
            : "Please check the file columns and try again.",
        ],
      });
    }
  };

  const deleteFile = async (fileId) => {
    const file = files.find((item) => item.id === fileId);
    const confirmed = await modal.confirm({
      cancelLabel: "Keep file",
      confirmLabel: "Delete",
      message:
        file?.originalName || "This uploaded file record will be removed.",
      title: "Delete uploaded file?",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    try {
      setStatusText("Deleting uploaded file record...");
      await onDeleteFile(fileId);
      setSelectedFileId(null);
      setStatusText("File record deleted.");
      await modal.success(
        "File deleted successfully",
        "The uploaded file record was removed.",
      );
    } catch (error) {
      setStatusText(error?.message || "File delete failed. Please try again.");
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        eyebrow="File Uploads"
        iconLabel="F"
        iconTone="neutral"
        title="Files"
        subtitle="Upload a spreadsheet, review its extracted preview, then import the saved rows into Products."
      />

      <View style={styles.stepBar}>
        <StepPill index="1" label="Upload" active />
        <StepPill index="2" label="Review" active={Boolean(selectedFile)} />
        <StepPill index="3" label="Import" active={Boolean(importResult)} />
      </View>

      <View style={styles.uploadCard}>
        {typeof document !== "undefined" && (
          <input
            accept=".csv,.xls,.xlsx"
            onChange={handleFileChange}
            ref={inputRef}
            style={{ display: "none" }}
            type="file"
          />
        )}
        <View style={styles.uploadCopy}>
          <Text style={styles.uploadTitle}>Upload spreadsheet</Text>
          <Text style={styles.uploadText}>
            Columns can include product/name, SKU/code, quantity, category,
            supplier, MRP, buy price, sell price, GST, and unit. The preview
            shows up to 100 rows; Submit imports the complete file.
          </Text>
          {!!statusText && <Text style={styles.statusText}>{statusText}</Text>}
        </View>
        <AppButton disabled={isBusy} label="Upload File" onPress={pickFile} />
      </View>

      <View style={styles.summaryGrid}>
        <MetricTile
          label="File status"
          value={fileStatus}
          tone={importResult ? "success" : issueCount ? "warning" : "primary"}
        />
        <MetricTile label="Total rows" value={selectedFile?.rowCount || 0} />
        <MetricTile label="Preview rows" value={editableRows.length} />
        <MetricTile label="Ready rows" value={readyRows} tone="success" />
        <MetricTile
          label="Rows with issues"
          value={issueCount}
          tone={issueCount ? "danger" : "success"}
        />
      </View>

      <View style={styles.actionStrip}>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={!selectedFile || isBusy}
          onPress={() => setIsEditing((value) => !value)}
          style={[
            styles.editButton,
            (!selectedFile || isBusy) && styles.disabledAction,
          ]}
        >
          <Text style={styles.editText}>
            {isEditing ? "Stop Edit" : "Edit"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={!canSubmit}
          onPress={submitProducts}
          style={[styles.submitButton, !canSubmit && styles.disabledAction]}
        >
          <Text style={styles.submitText}>Submit Products</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        <View style={styles.listCard}>
          <Text style={styles.sectionTitle}>Uploaded files</Text>
          {!files.length ? (
            <Text style={styles.emptyText}>No files uploaded yet.</Text>
          ) : (
            files.map((file) => {
              const isActive = selectedFile?.id === file.id;
              return (
                <TouchableOpacity
                  activeOpacity={0.85}
                  key={file.id}
                  onPress={() => setSelectedFileId(file.id)}
                  style={[styles.fileRow, isActive && styles.fileRowActive]}
                >
                  <View style={styles.fileInfo}>
                    <Text style={styles.fileName}>{file.originalName}</Text>
                    <Text style={styles.fileMeta}>
                      {file.fileType?.toUpperCase()} - {file.rowCount || 0} rows
                      - {formatDate(file.createdAt)}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.fileBadge,
                      isActive && styles.fileBadgeActive,
                    ]}
                  >
                    {isActive ? "Selected" : "Uploaded"}
                  </Text>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    disabled={isBusy}
                    onPress={() => deleteFile(file.id)}
                    style={styles.deleteButton}
                  >
                    <Text style={styles.deleteText}>Delete</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <View style={styles.previewCard}>
          <Text style={styles.sectionTitle}>Extracted preview</Text>
          {!selectedFile ? (
            <Text style={styles.emptyText}>
              Upload a file to see extracted data here.
            </Text>
          ) : (
            <>
              <View style={styles.previewHeader}>
                <View>
                  <Text style={styles.previewTitle}>
                    {selectedFile.originalName}
                  </Text>
                  <Text style={styles.previewMeta}>
                    {selectedFile.rowCount || 0} total rows · showing first{" "}
                    {editableRows.length} for review
                    {hasEditedRows
                      ? " · preview changes will be applied before import"
                      : ""}
                  </Text>
                </View>
                {!!issueCount && (
                  <Text style={styles.issueBadge}>
                    {issueCount} needs review
                  </Text>
                )}
              </View>

              {!!importResult && (
                <View style={styles.resultBox}>
                  <Text style={styles.resultText}>
                    Created {importResult.created || 0}, Updated{" "}
                    {importResult.updated || 0}, Skipped{" "}
                    {importResult.skipped || 0}
                  </Text>
                  {(importResult.messages || [])
                    .slice(0, 4)
                    .map((message, index) => (
                      <Text
                        key={`${message}-${index}`}
                        style={styles.resultHint}
                      >
                        {message}
                      </Text>
                    ))}
                </View>
              )}

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.table}>
                  <View style={styles.tableRow}>
                    <Text
                      style={[
                        styles.tableCell,
                        styles.rowNumberCell,
                        styles.tableHeadCell,
                      ]}
                    >
                      #
                    </Text>
                    <Text
                      style={[
                        styles.tableCell,
                        styles.issueCell,
                        styles.tableHeadCell,
                      ]}
                    >
                      Status
                    </Text>
                    {(selectedFile.columns || []).map((column) => (
                      <Text
                        key={column}
                        style={[styles.tableCell, styles.tableHeadCell]}
                      >
                        {column}
                      </Text>
                    ))}
                  </View>
                  {(editableRows || []).map((row, rowIndex) => (
                    <View
                      key={`${selectedFile.id}-${rowIndex}`}
                      style={[
                        styles.tableRow,
                        rowIssues[rowIndex]?.length && styles.issueRow,
                      ]}
                    >
                      <Text style={[styles.tableCell, styles.rowNumberCell]}>
                        {rowIndex + 1}
                      </Text>
                      <Text
                        style={[
                          styles.tableCell,
                          styles.issueCell,
                          rowIssues[rowIndex]?.length
                            ? styles.issueText
                            : styles.readyText,
                        ]}
                      >
                        {rowIssues[rowIndex]?.length
                          ? rowIssues[rowIndex].join(" | ")
                          : "Ready"}
                      </Text>
                      {(selectedFile.columns || []).map((column) =>
                        isEditing ? (
                          <TextInput
                            key={`${selectedFile.id}-${rowIndex}-${column}`}
                            onChangeText={(value) =>
                              updateCell(rowIndex, column, value)
                            }
                            style={[styles.tableCell, styles.tableInput]}
                            value={String(row[column] || "")}
                          />
                        ) : (
                          <Text
                            key={`${selectedFile.id}-${rowIndex}-${column}`}
                            style={styles.tableCell}
                          >
                            {row[column] || "-"}
                          </Text>
                        ),
                      )}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function StepPill({ active, index, label }) {
  return (
    <View style={[styles.stepPill, active && styles.stepPillActive]}>
      <Text style={[styles.stepNumber, active && styles.stepNumberActive]}>
        {index}
      </Text>
      <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>
        {label}
      </Text>
    </View>
  );
}

function MetricTile({ label, tone = "primary", value }) {
  return (
    <View style={[styles.metricTile, styles[`${tone}MetricTile`]]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, styles[`${tone}MetricText`]]}>
        {String(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: spacing.xl },
  stepBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  stepPill: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  stepPillActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  stepNumber: {
    backgroundColor: colors.background,
    borderRadius: 999,
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  stepNumberActive: { backgroundColor: colors.primary, color: colors.white },
  stepLabel: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "800",
  },
  stepLabelActive: { color: colors.primaryDark },
  uploadCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  uploadCopy: { flex: 1, gap: spacing.xs },
  uploadTitle: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 18,
    fontWeight: "700",
  },
  uploadText: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 13,
    lineHeight: 19,
  },
  statusText: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  metricTile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: 150,
    flexGrow: 1,
    minHeight: 76,
    padding: spacing.md,
  },
  primaryMetricTile: { borderLeftColor: colors.primary },
  successMetricTile: { borderLeftColor: colors.success },
  warningMetricTile: { borderLeftColor: colors.warning },
  dangerMetricTile: { borderLeftColor: colors.danger },
  metricLabel: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: "800",
  },
  metricValue: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 20,
    fontWeight: "800",
    marginTop: spacing.xs,
  },
  primaryMetricText: { color: colors.primaryDark },
  successMetricText: { color: colors.success },
  warningMetricText: { color: colors.warning },
  dangerMetricText: { color: colors.danger },
  actionStrip: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  disabledAction: { opacity: 0.55 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  listCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flex: 0.8,
    minWidth: 300,
    gap: spacing.sm,
    padding: spacing.md,
  },
  previewCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flex: 1.2,
    minWidth: 520,
    gap: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 18,
    fontWeight: "700",
  },
  emptyText: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 13,
    lineHeight: 19,
  },
  fileRow: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  fileRowActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  fileInfo: { flex: 1, gap: 3 },
  fileName: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 14,
    fontWeight: "700",
  },
  fileMeta: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: "700",
  },
  fileBadge: {
    backgroundColor: colors.background,
    borderRadius: 999,
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 10,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  fileBadgeActive: { backgroundColor: colors.primary, color: colors.white },
  deleteButton: {
    backgroundColor: colors.dangerSoft,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  deleteText: {
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: "700",
  },
  previewHeader: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    padding: spacing.sm,
  },
  previewTitle: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 14,
    fontWeight: "700",
  },
  previewMeta: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: "700",
  },
  issueBadge: {
    backgroundColor: colors.warningSoft,
    borderRadius: 999,
    color: colors.warning,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  previewActions: { flexDirection: "row", gap: spacing.xs },
  editButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  editText: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
  },
  submitText: {
    color: colors.white,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
  },
  resultBox: {
    backgroundColor: colors.successSoft,
    borderRadius: radii.md,
    gap: 2,
    padding: spacing.sm,
  },
  resultText: {
    color: colors.success,
    fontFamily: typography.baseFont,
    fontSize: 13,
    fontWeight: "700",
  },
  resultHint: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: "700",
  },
  table: {
    borderColor: colors.border,
    borderLeftWidth: 1,
    borderTopWidth: 1,
    minWidth: 720,
  },
  tableRow: { flexDirection: "row" },
  issueRow: { backgroundColor: colors.warningSoft },
  tableCell: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    borderRightColor: colors.border,
    borderRightWidth: 1,
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 12,
    minWidth: 150,
    padding: spacing.sm,
  },
  rowNumberCell: { minWidth: 54, textAlign: "center" },
  issueCell: { minWidth: 220 },
  issueText: { color: colors.danger, fontWeight: "800" },
  readyText: { color: colors.success, fontWeight: "800" },
  tableHeadCell: {
    backgroundColor: colors.primarySoft,
    color: colors.primary,
    fontWeight: "700",
  },
  tableInput: {
    backgroundColor: colors.white,
    minHeight: 42,
    outlineStyle: "none",
  },
});
