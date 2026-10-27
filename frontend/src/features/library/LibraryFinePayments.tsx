import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { getPrintInstitutionBranding } from "lib/printBranding";
import { printElementById } from "lib/printUtils";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";

type PaymentRow = {
  key: string;
  issueId: string;
  action: "PAID" | "WAIVED";
  amountNpr: number;
  dateBs: string;
  dateAd: string;
  whileOut: boolean;
  throughBs: string;
  byName: string;
  note: string;
  studentName: string;
  admissionNumber: string;
  rollNumber: number | null;
  batchName: string;
  yearName: string;
  bookTitle: string;
  bookCode: string;
  dueDateBs: string;
  returnedDateBs: string;
};

type PaymentsResponse = {
  rows: PaymentRow[];
  totals: { paidNpr: number; waivedNpr: number; paidCount: number; waivedCount: number };
};

const PRINT_ID = "library-fine-payments-print";

const ACTION_LABEL: Record<PaymentRow["action"], string> = { PAID: "Paid", WAIVED: "Waived" };

/**
 * Library → Overdue Fines → Payments: every fine payment and waiver, one row
 * each (also those taken while the book was still out), with filters, print
 * and Excel.
 */
export const LibraryFinePayments = () => {
  const [type, setType] = useState<"ALL" | "PAID" | "WAIVED">("ALL");
  const [fromBs, setFromBs] = useState("");
  const [toBs, setToBs] = useState("");
  const [search, setSearch] = useState("");
  const [printing, setPrinting] = useState(false);

  const query = useQuery({
    queryKey: ["library-fines", "payments", type, fromBs, toBs],
    queryFn: () =>
      unwrap<PaymentsResponse>(
        api.get("/library/fines/payments", {
          params: { type, fromBs: fromBs || undefined, toBs: toBs || undefined },
        }),
      ),
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = query.data?.rows ?? [];
    if (!needle) return list;
    return list.filter((row) =>
      [row.studentName, row.admissionNumber, String(row.rollNumber ?? ""), row.bookTitle, row.bookCode, row.byName]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query.data, search]);

  // Totals of what is shown (after search)
  const shown = useMemo(
    () =>
      rows.reduce(
        (t, row) => {
          if (row.action === "PAID") t.paid += row.amountNpr;
          else t.waived += row.amountNpr;
          return t;
        },
        { paid: 0, waived: 0 },
      ),
    [rows],
  );

  const scopeLine = [
    type === "ALL" ? "Paid and waived" : ACTION_LABEL[type],
    fromBs || toBs ? `${fromBs || "start"} to ${toBs || "today"} (BS)` : "All dates",
    search.trim() ? `Search: ${search.trim()}` : "",
  ]
    .filter(Boolean)
    .join("  ·  ");

  const studentLine = (row: PaymentRow) =>
    [row.admissionNumber, row.rollNumber != null ? `Roll ${row.rollNumber}` : "", [row.batchName, row.yearName].filter(Boolean).join(" / ")]
      .filter(Boolean)
      .join(" · ");

  const exportExcel = () => {
    if (rows.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const sheet = XLSX.utils.json_to_sheet(
      rows.map((row, index) => ({
        "S.N.": index + 1,
        "Date (BS)": row.dateBs,
        "Date (AD)": row.dateAd,
        Student: row.studentName,
        "Admission no.": row.admissionNumber,
        "Roll no.": row.rollNumber ?? "",
        Batch: row.batchName,
        Year: row.yearName,
        Book: row.bookTitle,
        "Book code": row.bookCode,
        Type: ACTION_LABEL[row.action],
        "Amount (NPR)": row.amountNpr,
        "Book status": row.whileOut ? "Still out at the time" : `Returned ${row.returnedDateBs}`,
        "Recorded by": row.byName,
        Note: row.note,
      })),
    );
    sheet["!cols"] = [6, 12, 12, 26, 14, 8, 14, 12, 30, 12, 9, 13, 22, 18, 30].map((wch) => ({ wch }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Fine payments");
    XLSX.writeFile(book, `library-fine-payments-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("Excel downloaded");
  };

  const print = async () => {
    if (rows.length === 0) {
      toast.error("Nothing to print");
      return;
    }
    setPrinting(true);
    try {
      await printElementById(PRINT_ID, "library-fine-payments", "a4-landscape");
    } catch (e) {
      toast.error(parseErrorMessage(e));
    } finally {
      setPrinting(false);
    }
  };

  const branding = getPrintInstitutionBranding();

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <FormField label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="ALL">Paid and waived</option>
            <option value="PAID">Paid only</option>
            <option value="WAIVED">Waived only</option>
          </Select>
        </FormField>
        <FormField label="From (BS)">
          <NepaliDateField value={fromBs} onChange={setFromBs} />
        </FormField>
        <FormField label="To (BS)">
          <NepaliDateField value={toBs} onChange={setToBs} />
        </FormField>
        <FormField label="Search">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Student, admission, roll, book…"
          />
        </FormField>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-emerald-800">
            Collected <span className="font-semibold">{formatCurrencyNpr(shown.paid)}</span>
          </span>
          <span className="rounded-lg bg-sky-50 px-3 py-1.5 text-sky-800">
            Waived <span className="font-semibold">{formatCurrencyNpr(shown.waived)}</span>
          </span>
          <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700">
            {rows.length} record{rows.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex gap-2">
          {fromBs || toBs ? (
            <Button type="button" variant="outline" size="sm" onClick={() => { setFromBs(""); setToBs(""); }}>
              Clear dates
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" disabled={rows.length === 0 || printing} onClick={() => void print()}>
            <Printer className="mr-1.5 h-4 w-4" />
            {printing ? "Preparing…" : "Print"}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={rows.length === 0} onClick={exportExcel}>
            <Download className="mr-1.5 h-4 w-4" />
            Excel
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <EmptyState title="Could not load payments" description={parseErrorMessage(query.error)} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No payments"
          description="Fine payments and waivers will be listed here once recorded."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <Table>
            <TableHead>
              <tr>
                <Th className="whitespace-nowrap">Date</Th>
                <Th>Student</Th>
                <Th>Book</Th>
                <Th>Type</Th>
                <Th className="text-right">Amount</Th>
                <Th>Book status</Th>
                <Th>Recorded by</Th>
                <Th>Note</Th>
              </tr>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <Td className="whitespace-nowrap">
                    <div>{row.dateBs}</div>
                    <div className="text-xs text-slate-500">{row.dateAd}</div>
                  </Td>
                  <Td>
                    <div className="font-medium text-slate-900">{row.studentName}</div>
                    <div className="text-xs text-slate-500">{studentLine(row)}</div>
                  </Td>
                  <Td>
                    <div className="text-sm">{row.bookTitle}</div>
                    {row.bookCode ? <div className="text-xs text-slate-500">{row.bookCode}</div> : null}
                  </Td>
                  <Td>
                    <Badge className={row.action === "PAID" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}>
                      {ACTION_LABEL[row.action]}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-right font-semibold">{formatCurrencyNpr(row.amountNpr)}</Td>
                  <Td className="text-xs text-slate-600">
                    {row.whileOut ? (
                      <span className="text-amber-800">Still out at the time</span>
                    ) : row.returnedDateBs ? (
                      `Returned ${row.returnedDateBs}`
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="text-sm">{row.byName || "—"}</Td>
                  <Td className="max-w-[14rem] text-sm text-slate-600">{row.note || "—"}</Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Print layout (hidden on screen) */}
      <div id={PRINT_ID} className="hidden print:block" aria-hidden="true">
        <div style={{ textAlign: "center", borderBottom: "2px solid #0f172a", paddingBottom: 8, marginBottom: 10 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, textTransform: "uppercase" }}>
            {branding.name || "Institution"}
          </p>
          {branding.address ? <p style={{ margin: "2px 0 0", fontSize: 10 }}>{branding.address}</p> : null}
          <p style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 600 }}>Library fine payments</p>
          <p style={{ margin: "2px 0 0", fontSize: 10 }}>{scopeLine}</p>
          <p style={{ margin: "2px 0 0", fontSize: 10 }}>
            Collected {formatCurrencyNpr(shown.paid)} · Waived {formatCurrencyNpr(shown.waived)} · {rows.length} record
            {rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            <tr>
              {["S.N.", "Date (BS)", "Student", "Admission / Roll", "Batch / Year", "Book", "Type", "Amount", "Recorded by", "Note"].map((h) => (
                <th key={h} style={{ border: "1px solid #94a3b8", background: "#f1f5f9", padding: "4px 5px", textAlign: "left" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key}>
                <td style={{ border: "1px solid #cbd5e1", padding: "3px 5px" }}>{index + 1}</td>
                <td style={{ border: "1px solid #cbd5e1", padding: "3px 5px", whiteSpace: "nowrap" }}>{row.dateBs}</td>
                <td style={{ border: "1px solid #cbd5e1", padding: "3px 5px", fontWeight: 600 }}>{row.studentName}</td>
                <td style={{ border: "1px solid #cbd5e1", padding: "3px 5px" }}>
                  {[row.admissionNumber, row.rollNumber != null ? `Roll ${row.rollNumber}` : ""].filter(Boolean).join(" · ") || "—"}
                </td>
                <td style={{ border: "1px solid #cbd5e1", padding: "3px 5px" }}>
                  {[row.batchName, row.yearName].filter(Boolean).join(" / ") || "—"}
                </td>
                <td style={{ border: "1px solid #cbd5e1", padding: "3px 5px" }}>
                  {row.bookTitle}
                  {row.bookCode ? ` [${row.bookCode}]` : ""}
                </td>
                <td style={{ border: "1px solid #cbd5e1", padding: "3px 5px" }}>{ACTION_LABEL[row.action]}</td>
                <td style={{ border: "1px solid #cbd5e1", padding: "3px 5px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {formatCurrencyNpr(row.amountNpr)}
                </td>
                <td style={{ border: "1px solid #cbd5e1", padding: "3px 5px" }}>{row.byName || "—"}</td>
                <td style={{ border: "1px solid #cbd5e1", padding: "3px 5px" }}>{row.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
