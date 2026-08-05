import { useMemo, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import type {
  LaboratoryEquipmentRecord,
  LaboratoryRecord,
} from "@phit-erp/shared";
import { ChevronDown, ChevronRight, Printer } from "lucide-react";
import { toast } from "sonner";
import { CollegeLogo } from "components/shared/CollegeLogo";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { useAuth } from "features/auth/AuthProvider";
import { StockStatusBadge } from "features/library/StockStatusBadge";
import {
  exportLaboratoryInventoryPdf,
  itemKindOptions,
  LABORATORY_YEAR_LEVELS,
  type LaboratoryYearLevel,
} from "features/laboratory/labUtils";
import { api, unwrap } from "lib/api";
import { getCollegeDisplayName } from "lib/auth";
import { getPrintInstitutionBranding } from "lib/printBranding";
import { printElementById } from "lib/printUtils";
import { parseErrorMessage } from "lib/utils";

const PRINT_AREA_ID = "laboratory-print-inventory-area";

const itemKindLabel = (kind?: string) => {
  if (kind === "DISPOSABLE") return "Disposable / Destroyable";
  if (kind === "NON_DISPOSABLE") return "Non-Disposable / Non-Destroyable";
  return kind?.replace(/_/g, " ") || "—";
};

const formatCost = (cost?: number) => {
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost <= 0) {
    return "—";
  }
  return cost.toLocaleString("en-NP");
};

const kindShort = (kind?: string) => {
  if (kind === "DISPOSABLE") return "Disposable";
  if (kind === "NON_DISPOSABLE") return "Non-disp.";
  return itemKindLabel(kind);
};

const thStyle: CSSProperties = {
  border: "1px solid #94a3b8",
  background: "#f1f5f9",
  padding: "4px 3px",
  fontSize: 9,
  fontWeight: 700,
  textAlign: "left",
  whiteSpace: "nowrap",
  color: "#0f172a",
};

const tdStyle: CSSProperties = {
  border: "1px solid #cbd5e1",
  padding: "3px 3px",
  fontSize: 9,
  color: "#0f172a",
  verticalAlign: "top",
};

export const LaboratoryPrintInventoryPanel = () => {
  const { user, availableSchools } = useAuth();
  const printBranding = getPrintInstitutionBranding();
  const institutionName =
    getCollegeDisplayName(availableSchools, user) ||
    printBranding.name ||
    "Institution";
  const institutionAddress = printBranding.address?.trim() || "";

  const [search, setSearch] = useState("");
  const [labFilter, setLabFilter] = useState("");
  const [itemKindFilter, setItemKindFilter] = useState("");
  const [yearFilter, setYearFilter] = useState<"ALL" | LaboratoryYearLevel>(
    "ALL",
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [printItems, setPrintItems] = useState<LaboratoryEquipmentRecord[]>([]);
  const [printTitle, setPrintTitle] = useState("Laboratory Equipment Inventory");
  const [printing, setPrinting] = useState(false);

  const labsQuery = useQuery({
    queryKey: ["laboratory-labs"],
    queryFn: () => unwrap<LaboratoryRecord[]>(api.get("/laboratory/labs")),
  });

  const equipmentQuery = useQuery({
    queryKey: [
      "laboratory-equipment",
      labFilter,
      search,
      itemKindFilter,
      yearFilter,
      "",
    ],
    queryFn: () =>
      unwrap<LaboratoryEquipmentRecord[]>(
        api.get("/laboratory/equipment", {
          params: {
            laboratoryId: labFilter || undefined,
            search: search || undefined,
            itemKind: itemKindFilter || undefined,
            yearLevel: yearFilter !== "ALL" ? yearFilter : undefined,
          },
        }),
      ),
  });

  const items = equipmentQuery.data ?? [];
  const totalQty = useMemo(
    () => items.reduce((sum, item) => sum + (item.quantity || 0), 0),
    [items],
  );

  const safeFilename = (name: string) =>
    name
      .replace(/[^\w\s\-().]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "laboratory-inventory";

  const runExport = async (
    selected: LaboratoryEquipmentRecord[],
    title: string,
    mode: "print" | "pdf",
  ): Promise<void> => {
    if (selected.length === 0) {
      toast.error("No equipment to print");
      return;
    }
    setPrinting(true);
    flushSync(() => {
      setPrintItems(selected);
      setPrintTitle(title);
    });
    const onlyItem = selected.length === 1 ? selected[0] : undefined;
    try {
      if (mode === "pdf") {
        const fileBase = onlyItem
          ? `lab-equipment-${safeFilename(onlyItem.name)}`
          : "laboratory-inventory-all";
        await exportLaboratoryInventoryPdf(selected, {
          institutionName,
          institutionAddress,
          title,
          filename: `${fileBase}.pdf`,
        });
        toast.success(
          onlyItem
            ? `PDF downloaded for “${onlyItem.name}”`
            : `PDF downloaded — ${selected.length} items with full details`,
        );
      } else {
        const el = document.getElementById(PRINT_AREA_ID);
        if (!el || !el.textContent?.trim()) {
          throw new Error("Print content is empty — try again");
        }
        await printElementById(PRINT_AREA_ID, "laboratory-inventory-print");
        toast.success(
          onlyItem
            ? `Print dialog opened for “${onlyItem.name}”`
            : `Print dialog opened for ${selected.length} items`,
        );
      }
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setPrinting(false);
    }
  };

  const allTitle =
    labFilter && labsQuery.data
      ? `Laboratory Inventory — ${
          labsQuery.data.find((l) => l._id === labFilter)?.name ?? "Lab"
        }`
      : yearFilter === "ALL"
        ? "Laboratory Equipment Inventory — All Items"
        : `Laboratory Equipment Inventory — ${yearFilter}`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Print inventory</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Print or download PDF for one equipment item with full details, or
              the full laboratory inventory with every item and stock quantity.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void runExport(items, allTitle, "print")}
              disabled={printing || items.length === 0}
            >
              <Printer className="mr-2 h-4 w-4" />
              {printing ? "Preparing…" : "Print all"}
            </Button>
            <Button
              onClick={() => void runExport(items, allTitle, "pdf")}
              disabled={printing || items.length === 0}
            >
              {printing ? "Preparing…" : "Download PDF (all)"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="w-auto min-w-[160px]"
              value={labFilter}
              onChange={(e) => setLabFilter(e.target.value)}
            >
              <option value="">All laboratories</option>
              {(labsQuery.data ?? []).map((lab) => (
                <option key={lab._id} value={lab._id}>
                  {lab.name}
                </option>
              ))}
            </Select>
            <Select
              className="w-auto min-w-[140px]"
              value={yearFilter}
              onChange={(e) =>
                setYearFilter(e.target.value as "ALL" | LaboratoryYearLevel)
              }
            >
              <option value="ALL">All years</option>
              {LABORATORY_YEAR_LEVELS.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
            <Select
              className="w-auto min-w-[160px]"
              value={itemKindFilter}
              onChange={(e) => setItemKindFilter(e.target.value)}
            >
              <option value="">All kinds</option>
              {itemKindOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
            <Input
              className="max-w-sm"
              placeholder="Search name, code, brand…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <p className="text-sm text-slate-500">
              {items.length} item{items.length === 1 ? "" : "s"} · qty {totalQty}
            </p>
          </div>

          {equipmentQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Loading inventory…
            </p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No equipment matches this filter. Add items in Inventory first.
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((item, index) => {
                const expanded = expandedId === item._id;
                return (
                  <div
                    key={item._id}
                    className="rounded-lg border border-slate-200"
                  >
                    <div className="flex w-full flex-wrap items-center gap-2 px-3 py-3">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-90"
                        onClick={() =>
                          setExpandedId(expanded ? null : item._id)
                        }
                      >
                        <span className="w-8 shrink-0 text-center text-sm tabular-nums text-slate-500">
                          {index + 1}
                        </span>
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-slate-900">
                              {item.name}
                            </p>
                            <Badge className="bg-slate-100 font-mono text-slate-700">
                              {item.itemCode}
                            </Badge>
                            <Badge className="bg-indigo-100 text-indigo-800">
                              {item.yearLevel ?? "All Years"}
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-500">
                            {item.laboratoryName || "—"} ·{" "}
                            {item.categoryName || "—"} · qty {item.quantity} ·
                            available {item.availableQuantity}
                            {item.brand ? ` · ${item.brand}` : ""}
                          </p>
                        </div>
                        <StockStatusBadge status={item.status} />
                      </button>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={printing}
                          onClick={() =>
                            void runExport(
                              [item],
                              `Laboratory Equipment — ${item.name}`,
                              "print",
                            )
                          }
                        >
                          <Printer className="mr-1.5 h-3.5 w-3.5" />
                          Print
                        </Button>
                        <Button
                          size="sm"
                          disabled={printing}
                          onClick={() =>
                            void runExport(
                              [item],
                              `Laboratory Equipment — ${item.name}`,
                              "pdf",
                            )
                          }
                        >
                          PDF
                        </Button>
                      </div>
                    </div>
                    {expanded ? (
                      <div className="border-t border-slate-100 px-3 py-3">
                        <div className="overflow-x-auto">
                          <Table className="min-w-[720px]">
                            <TableHead>
                              <tr>
                                <Th>Field</Th>
                                <Th>Value</Th>
                                <Th>Field</Th>
                                <Th>Value</Th>
                              </tr>
                            </TableHead>
                            <TableBody>
                              <tr>
                                <Td className="font-medium text-slate-600">
                                  Item code
                                </Td>
                                <Td className="font-mono">{item.itemCode}</Td>
                                <Td className="font-medium text-slate-600">
                                  Laboratory
                                </Td>
                                <Td>{item.laboratoryName || "—"}</Td>
                              </tr>
                              <tr>
                                <Td className="font-medium text-slate-600">
                                  Category
                                </Td>
                                <Td>{item.categoryName || "—"}</Td>
                                <Td className="font-medium text-slate-600">
                                  Kind
                                </Td>
                                <Td>{itemKindLabel(item.itemKind)}</Td>
                              </tr>
                              <tr>
                                <Td className="font-medium text-slate-600">
                                  Quantity
                                </Td>
                                <Td>
                                  {item.quantity} total ·{" "}
                                  {item.availableQuantity} available ·{" "}
                                  {item.issuedQuantity} issued
                                </Td>
                                <Td className="font-medium text-slate-600">
                                  Condition
                                </Td>
                                <Td>
                                  {item.condition} / {item.equipmentStatus}
                                </Td>
                              </tr>
                              <tr>
                                <Td className="font-medium text-slate-600">
                                  Storage
                                </Td>
                                <Td>{item.storageLocation || "—"}</Td>
                                <Td className="font-medium text-slate-600">
                                  Cost (NPR)
                                </Td>
                                <Td>{formatCost(item.purchaseCost)}</Td>
                              </tr>
                              <tr>
                                <Td className="font-medium text-slate-600">
                                  Brand / model
                                </Td>
                                <Td>
                                  {item.brand || "—"} /{" "}
                                  {item.equipmentModel || "—"}
                                </Td>
                                <Td className="font-medium text-slate-600">
                                  Supplier
                                </Td>
                                <Td>{item.supplier || "—"}</Td>
                              </tr>
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hidden print layout — compact inventory table (landscape-friendly) */}
      <div
        id={PRINT_AREA_ID}
        className="hidden print:block"
        aria-hidden="true"
        style={{
          background: "#ffffff",
          color: "#0f172a",
          padding: 12,
          fontFamily:
            '"IBM Plex Sans", "Noto Sans Devanagari", "Nirmala UI", sans-serif',
        }}
      >
        <header
          style={{
            marginBottom: 10,
            paddingBottom: 8,
            borderBottom: "1px solid #94a3b8",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CollegeLogo className="h-12 w-12 shrink-0" />
            <div style={{ minWidth: 0 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              >
                {institutionName || "Institution"}
              </p>
              {institutionAddress ? (
                <p
                  style={{
                    margin: "2px 0 0",
                    fontSize: 10,
                    color: "#475569",
                    lineHeight: 1.35,
                  }}
                >
                  {institutionAddress}
                </p>
              ) : null}
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#1e293b",
                }}
              >
                {printTitle}
              </p>
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 10,
                  color: "#475569",
                }}
              >
                Equipment inventory table · {printItems.length} item
                {printItems.length === 1 ? "" : "s"} · total qty{" "}
                {printItems.reduce((n, i) => n + (i.quantity || 0), 0)}
              </p>
            </div>
          </div>
        </header>

        {printItems.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: "#475569" }}>
            No equipment selected to print.
          </p>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
            }}
          >
            <thead>
              <tr>
                {(
                  [
                    "S.N.",
                    "Code",
                    "Equipment",
                    "Laboratory",
                    "Category",
                    "Year",
                    "Kind",
                    "Brand",
                    "Model",
                    "Unit",
                    "Qty",
                    "Avl",
                    "Iss",
                    "Stock",
                    "Cond.",
                    "Eq.status",
                    "Storage",
                    "Supplier",
                    "Cost",
                    "Purch.",
                  ] as const
                ).map((h) => (
                  <th key={h} style={thStyle}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...printItems]
                .sort((a, b) => {
                  const lab = (a.laboratoryName || "").localeCompare(
                    b.laboratoryName || "",
                  );
                  if (lab !== 0) return lab;
                  return (a.name || "").localeCompare(b.name || "");
                })
                .map((item, index) => (
                  <tr
                    key={item._id}
                    style={{
                      background: index % 2 === 1 ? "#f8fafc" : "#ffffff",
                    }}
                  >
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      {index + 1}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                      {item.itemCode || "—"}
                    </td>
                    <td style={tdStyle}>{item.name || "—"}</td>
                    <td style={tdStyle}>{item.laboratoryName || "—"}</td>
                    <td style={tdStyle}>{item.categoryName || "—"}</td>
                    <td style={tdStyle}>{item.yearLevel ?? "All"}</td>
                    <td style={tdStyle}>{kindShort(item.itemKind)}</td>
                    <td style={tdStyle}>{item.brand?.trim() || "—"}</td>
                    <td style={tdStyle}>
                      {item.equipmentModel?.trim() || "—"}
                    </td>
                    <td style={tdStyle}>{item.unit || "pcs"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {item.quantity ?? 0}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {item.availableQuantity ?? 0}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {item.issuedQuantity ?? 0}
                    </td>
                    <td style={tdStyle}>{item.status || "—"}</td>
                    <td style={tdStyle}>{item.condition || "—"}</td>
                    <td style={tdStyle}>{item.equipmentStatus || "—"}</td>
                    <td style={tdStyle}>
                      {item.storageLocation?.trim() || "—"}
                    </td>
                    <td style={tdStyle}>{item.supplier?.trim() || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {formatCost(item.purchaseCost)}
                    </td>
                    <td style={tdStyle}>
                      {item.purchaseDateBs?.trim() || "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}

        <footer
          style={{
            marginTop: 10,
            paddingTop: 6,
            borderTop: "1px solid #cbd5e1",
            fontSize: 9,
            color: "#64748b",
          }}
        >
          <p style={{ margin: 0 }}>
            Laboratory equipment inventory · One row = one item · Confidential
          </p>
        </footer>
      </div>
    </div>
  );
};
