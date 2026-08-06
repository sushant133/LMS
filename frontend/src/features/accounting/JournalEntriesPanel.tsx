import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  VOUCHER_TYPES,
  amountToWordsNepali,
  type ChartOfAccountRecord,
  type GoshwaraVoucherInput,
  type GoshwaraVoucherRecord,
  type JournalEntryRecord,
  type JournalLineInput,
  type SchoolSettingsRecord,
  type VoucherType,
} from "@phit-erp/shared";
import { getTodayBs } from "@munatech/nepali-datepicker";
import {
  BookOpen,
  FileText,
  Plus,
  Printer,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, formatCurrencyNpr, parseErrorMessage } from "lib/utils";
import { formatDualDateCell } from "./accountingUtils";

type JournalPanelTab = "ledger" | "create" | "vouchers";

/**
 * Ensure the API path requests printable HTML (not PDF download).
 */
const withHtmlFormat = (apiPath: string): string => {
  const [pathPart, query = ""] = apiPath.split("?");
  const params = new URLSearchParams(query);
  params.set("format", "html");
  const qs = params.toString();
  return qs ? `${pathPart}?${qs}` : `${pathPart}?format=html`;
};

/**
 * Print a protected Goshwara voucher via authenticated fetch + hidden iframe.
 * Uses HTML (not PDF download) so the browser print dialog opens directly —
 * same pattern as purchase/expense voucher print.
 */
const printAuthenticatedDocument = async (apiPath: string): Promise<void> => {
  const htmlPath = withHtmlFormat(apiPath);
  const response = await api.get(htmlPath, {
    responseType: "blob",
    headers: { Accept: "text/html, application/pdf;q=0.5, */*;q=0.1" },
    // Puppeteer first launch can be slow when server still builds PDF fallback
    timeout: 120_000,
  });

  const raw = response.data as Blob;
  const headerType = String(response.headers["content-type"] ?? "");
  const contentType = `${headerType} ${raw.type || ""}`.toLowerCase();

  // API errors often arrive as JSON with responseType: blob
  if (contentType.includes("json") || contentType.includes("application/problem")) {
    const text = await raw.text();
    let message = "Could not open voucher for print";
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message || parsed.error || message;
    } catch {
      if (text.trim()) message = text.slice(0, 200);
    }
    throw new Error(message);
  }

  // Clone so we can inspect text without consuming the blob for a rare PDF fallback
  const sample = await raw.slice(0, 64).text();
  const trimmed = sample.trimStart().toLowerCase();
  const looksLikeHtml =
    contentType.includes("html") ||
    contentType.includes("text/plain") ||
    trimmed.startsWith("<!doctype") ||
    trimmed.startsWith("<html");

  if (looksLikeHtml) {
    const html = await raw.text();
    if (!html.trim()) throw new Error("Empty voucher document");
    printHtmlDocument(html);
    toast.success("Print dialog opening…");
    return;
  }

  // PDF fallback: iframe print only — never force a file download
  const pdfBlob =
    contentType.includes("pdf") || raw.type === "application/pdf"
      ? raw
      : new Blob([raw], { type: "application/pdf" });
  if (!pdfBlob.size) throw new Error("Empty voucher PDF");

  const url = URL.createObjectURL(pdfBlob);
  try {
    await printPdfBlobUrl(url);
    toast.success("Print dialog opening…");
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
  }
};

/**
 * Hidden iframe HTML print — avoids popup blockers and download prompts.
 * Clears document titles so the browser does not print header chrome like
 * "8/6/26, 11:04 PM" and "गोश्वारा भौचर".
 */
const printHtmlDocument = (html: string): void => {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    throw new Error("Could not open print preview");
  }

  // Strip <title> so browser print header has no voucher name
  const htmlForPrint = html.replace(
    /<title>[\s\S]*?<\/title>/i,
    "<title>\u200B</title>",
  );

  doc.open();
  doc.write(htmlForPrint);
  doc.close();

  // Browser print headers show date + document title — blank both parent & iframe
  const previousTitle = document.title;
  document.title = "\u200B";

  const cleanup = () => {
    document.title = previousTitle;
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  };

  window.setTimeout(() => {
    try {
      doc.title = "\u200B";
      win.document.title = "\u200B";
      win.focus();
      win.print();
    } catch {
      cleanup();
      throw new Error("Print failed");
    }
    win.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(cleanup, 60_000);
  }, 350);
};

/** PDF blob URL → iframe print (no <a download>). */
const printPdfBlobUrl = (url: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    document.body.appendChild(iframe);

    const cleanup = () => {
      try {
        iframe.remove();
      } catch {
        /* ignore */
      }
    };

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("PDF print timed out"));
    }, 30_000);

    iframe.onload = () => {
      window.clearTimeout(timeout);
      window.setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          window.setTimeout(cleanup, 60_000);
          resolve();
        } catch (e) {
          cleanup();
          reject(e instanceof Error ? e : new Error("PDF print failed"));
        }
      }, 400);
    };

    iframe.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error("Could not load PDF for print"));
    };

    iframe.src = url;
  });

const messageFromPdfError = async (error: unknown): Promise<string> => {
  if (typeof error === "object" && error && "response" in error) {
    const data = (error as { response?: { data?: unknown } }).response?.data;
    if (data instanceof Blob) {
      try {
        const text = await data.text();
        const parsed = JSON.parse(text) as { message?: string; error?: string };
        if (parsed.message || parsed.error) {
          return parsed.message || parsed.error || "Could not open PDF";
        }
      } catch {
        /* fall through */
      }
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return parseErrorMessage(error) || "Could not open PDF";
};

const formatTodayBs = (): string => {
  const d = getTodayBs();
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
};

const emptyLine = (): JournalLineInput => ({
  accountCode: "",
  accountName: "",
  debitNpr: 0,
  creditNpr: 0,
  description: "",
});

type PrintLine = {
  sn: string;
  particulars: string;
  account: string;
  ledgerNo: string;
  debit: number;
  credit: number;
};

const emptyPrintLine = (): PrintLine => ({
  sn: "",
  particulars: "",
  account: "",
  ledgerNo: "",
  debit: 0,
  credit: 0,
});

// Journal Entries tab = गोश्वारा भौचर (manual + auto-posted from fees/salary/refunds)

/** Voucher type labels in Nepali for the form */
const VOUCHER_TYPE_NP: Record<VoucherType, string> = {
  JOURNAL: "जर्नल",
  RECEIPT: "रसिद",
  PAYMENT: "भुक्तानी",
  CONTRA: "कन्ट्रा",
  SALES: "बिक्री",
  PURCHASE: "खरिद",
};

/** Inputs accept Nepali typing (Devanagari keyboard / OS IME) */
const npInputClass =
  "font-nepali lang-ne [font-family:'Noto_Sans_Devanagari','Nirmala_UI',Mangal,sans-serif]";

type CreateVoucherResponse = {
  voucher: GoshwaraVoucherRecord;
  journalEntry: JournalEntryRecord;
};

export const JournalEntriesPanel = ({
  canWrite,
  /** Super Admin / College Admin only — delete (reverse) journal entries */
  canDelete = false,
}: {
  canWrite: boolean;
  canDelete?: boolean;
}) => {
  const [tab, setTab] = useState<JournalPanelTab>("ledger");
  const [ledgerSearch, setLedgerSearch] = useState("");
  /** Tracks which PDF action is in progress (button disable + feedback). */
  const [printingKey, setPrintingKey] = useState<string | null>(null);

  // —— Manual header fields (printed as written) ——
  const [voucherNo, setVoucherNo] = useState("");
  const [voucherType, setVoucherType] = useState<VoucherType>("JOURNAL");
  const [dateBs, setDateBs] = useState(formatTodayBs);
  const [particulars, setParticulars] = useState("");

  // —— Optional bottom fields ——
  const [receiptNo, setReceiptNo] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [presenterName, setPresenterName] = useState("");
  const [presenterRank, setPresenterRank] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeAmount, setChequeAmount] = useState("");
  const [chequePresenter, setChequePresenter] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [chequeRank, setChequeRank] = useState("");
  const [amountInWords, setAmountInWords] = useState("");

  // —— Table rows for PDF (free text) ——
  const [printLines, setPrintLines] = useState<PrintLine[]>([
    emptyPrintLine(),
    emptyPrintLine(),
  ]);

  // —— Journal GL lines ——
  const [lines, setLines] = useState<JournalLineInput[]>([emptyLine(), emptyLine()]);

  const entriesQuery = useQuery({
    queryKey: ["journal-entries"],
    queryFn: () =>
      unwrap<JournalEntryRecord[]>(api.get("/accounting/journal-entries")),
  });

  const vouchersQuery = useQuery({
    queryKey: ["goshwara-vouchers"],
    queryFn: () =>
      unwrap<GoshwaraVoucherRecord[]>(api.get("/accounting/goshwara-vouchers")),
  });

  /**
   * Nepal Government document header (नेपाल सरकार / {college} कार्यालय / address).
   * Both Nepali values come from Institution Settings — never hardcoded here.
   */
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => unwrap<SchoolSettingsRecord>(api.get("/settings")),
  });
  const collegeNameNp = settingsQuery.data?.schoolNameNp?.trim() ?? "";
  const collegeAddressNp = settingsQuery.data?.schoolAddressNp?.trim() ?? "";

  const accountsQuery = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () =>
      unwrap<ChartOfAccountRecord[]>(api.get("/accounting/chart-of-accounts")),
    enabled: canWrite,
  });

  const activeAccounts = useMemo(
    () => (accountsQuery.data ?? []).filter((a) => a.isActive),
    [accountsQuery.data],
  );

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + (Number(l.debitNpr) || 0), 0);
    const credit = lines.reduce((s, l) => s + (Number(l.creditNpr) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 && debit > 0 };
  }, [lines]);

  const voucherByJournalId = useMemo(() => {
    const map = new Map<string, GoshwaraVoucherRecord>();
    for (const v of vouchersQuery.data ?? []) {
      if (v.journalEntryId) map.set(v.journalEntryId, v);
    }
    return map;
  }, [vouchersQuery.data]);

  const resetForm = () => {
    setVoucherNo("");
    setVoucherType("JOURNAL");
    setDateBs(formatTodayBs());
    setParticulars("");
    setReceiptNo("");
    setReceivedAmount("");
    setPresenterName("");
    setPresenterRank("");
    setChequeNo("");
    setChequeAmount("");
    setChequePresenter("");
    setChequeDate("");
    setChequeRank("");
    setAmountInWords("");
    setPrintLines([emptyPrintLine(), emptyPrintLine()]);
    setLines([emptyLine(), emptyLine()]);
  };

  const reverse = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.post(`/accounting/journal-entries/${id}/reverse`)),
    onSuccess: async () => {
      toast.success("Journal entry deleted (reversed)");
      const { invalidateAccountingQueries } = await import(
        "./invalidateAccountingQueries"
      );
      await invalidateAccountingQueries();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const deleteGoshwara = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/accounting/goshwara-vouchers/${id}`)),
    onSuccess: async () => {
      toast.success("Goshwara voucher deleted (journal reversed)");
      const { invalidateAccountingQueries } = await import(
        "./invalidateAccountingQueries"
      );
      await invalidateAccountingQueries();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const confirmDeleteJournal = (entry: JournalEntryRecord) => {
    if (
      !window.confirm(
        `Delete journal ${entry.voucherNumber}?\n\nThis posts a reversing entry so the ledger stays correct. Linked fee/expense items must be deleted from their own module.`,
      )
    ) {
      return;
    }
    reverse.mutate(entry._id);
  };

  const confirmDeleteGoshwara = (voucher: GoshwaraVoucherRecord) => {
    if (
      !window.confirm(
        `Delete Goshwara voucher ${voucher.voucherNo}?\n\nThis soft-deletes the voucher and posts a reversing journal entry so the ledger stays correct.`,
      )
    ) {
      return;
    }
    deleteGoshwara.mutate(voucher._id);
  };

  const createVoucher = useMutation({
    mutationFn: (payload: GoshwaraVoucherInput) =>
      unwrap<CreateVoucherResponse>(api.post("/accounting/goshwara-vouchers", payload)),
    onSuccess: async (data) => {
      toast.success(`Voucher ${data.voucher.voucherNo} saved — opening PDF…`);
      resetForm();
      setTab("ledger");
      const { invalidateAccountingQueries } = await import(
        "./invalidateAccountingQueries"
      );
      await invalidateAccountingQueries();
      // Open browser print dialog (HTML form — not a file download)
      const key = `voucher:${data.voucher._id}`;
      setPrintingKey(key);
      try {
        await printAuthenticatedDocument(
          `/accounting/goshwara-vouchers/${data.voucher._id}/pdf`,
        );
      } catch (e) {
        toast.error(await messageFromPdfError(e));
      } finally {
        setPrintingKey(null);
      }
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const openJournalGoshwara = async (
    journalId: string,
    opts?: { blank?: boolean },
  ) => {
    const params = new URLSearchParams();
    if (opts?.blank) params.set("blank", "1");
    const qs = params.toString() ? `?${params}` : "";
    const key = `journal:${journalId}:${opts?.blank ? "blank" : "print"}`;
    setPrintingKey(key);
    try {
      await printAuthenticatedDocument(
        `/accounting/journal-entries/${journalId}/goshwara-voucher${qs}`,
      );
    } catch (e) {
      toast.error(await messageFromPdfError(e));
    } finally {
      setPrintingKey(null);
    }
  };

  const openVoucherPdf = async (voucherId: string, blank = false) => {
    const qs = blank ? "?blank=1" : "";
    const key = `voucher:${voucherId}:${blank ? "blank" : "print"}`;
    setPrintingKey(key);
    try {
      await printAuthenticatedDocument(
        `/accounting/goshwara-vouchers/${voucherId}/pdf${qs}`,
      );
    } catch (e) {
      toast.error(await messageFromPdfError(e));
    } finally {
      setPrintingKey(null);
    }
  };

  const openBlankForm = async () => {
    const key = "blank-form";
    setPrintingKey(key);
    try {
      await printAuthenticatedDocument("/accounting/goshwara-vouchers/blank-form");
    } catch (e) {
      toast.error(await messageFromPdfError(e));
    } finally {
      setPrintingKey(null);
    }
  };

  const updateLine = (index: number, patch: Partial<JournalLineInput>) => {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...patch };
        if (patch.accountCode != null) {
          const acc = activeAccounts.find((a) => a.code === patch.accountCode);
          if (acc) next.accountName = acc.name;
        }
        if (patch.debitNpr != null && Number(patch.debitNpr) > 0) next.creditNpr = 0;
        if (patch.creditNpr != null && Number(patch.creditNpr) > 0) next.debitNpr = 0;
        return next;
      }),
    );
  };

  const updatePrintLine = (index: number, patch: Partial<PrintLine>) => {
    setPrintLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...patch };
        if (patch.debit != null && Number(patch.debit) > 0) next.credit = 0;
        if (patch.credit != null && Number(patch.credit) > 0) next.debit = 0;
        return next;
      }),
    );
  };

  /** Copy journal lines into free-text print rows (optional helper — not autofill on load) */
  const copyJournalToPrintLines = () => {
    setPrintLines(
      lines.map((l, i) => ({
        sn: String(i + 1),
        particulars: l.description || particulars,
        account: l.accountName || "",
        ledgerNo: l.accountCode || "",
        debit: Number(l.debitNpr) || 0,
        credit: Number(l.creditNpr) || 0,
      })),
    );
    toast.success("Journal lines copied to print table");
  };

  /** Fill amount in words from journal debit total (Nepali) */
  const fillAmountInWords = () => {
    if (totals.debit <= 0) {
      toast.error("Enter journal amounts first");
      return;
    }
    setAmountInWords(amountToWordsNepali(totals.debit));
    if (!receivedAmount.trim()) {
      setReceivedAmount(`रु. ${totals.debit.toLocaleString("en-IN")}`);
    }
  };

  const submitVoucher = (e: React.FormEvent) => {
    e.preventDefault();
    if (!particulars.trim()) {
      toast.error("Enter narration / particulars");
      return;
    }
    if (!totals.balanced) {
      toast.error("Debit and credit totals must match");
      return;
    }
    for (const [i, line] of lines.entries()) {
      if (!line.accountCode) {
        toast.error(`Line ${i + 1}: select an account`);
        return;
      }
      const d = Number(line.debitNpr) || 0;
      const c = Number(line.creditNpr) || 0;
      if ((d > 0 && c > 0) || (d <= 0 && c <= 0)) {
        toast.error(`Line ${i + 1}: enter debit or credit (not both)`);
        return;
      }
      if (!(line.description ?? "").trim()) {
        toast.error(
          `Line ${i + 1}: enter a reason / particular (e.g. cash received)`,
        );
        return;
      }
    }

    const words =
      amountInWords.trim() ||
      (totals.debit > 0 ? amountToWordsNepali(totals.debit) : undefined);

    const resolvedPrintLines = (
      printLines.some(
        (l) =>
          l.particulars || l.account || l.ledgerNo || l.debit > 0 || l.credit > 0,
      )
        ? printLines
        : lines.map((l, i) => ({
            sn: String(i + 1),
            particulars: (l.description ?? "").trim(),
            account: l.accountName || "",
            ledgerNo: l.accountCode || "",
            debit: Number(l.debitNpr) || 0,
            credit: Number(l.creditNpr) || 0,
          }))
    )
      .filter(
        (l) =>
          l.particulars || l.account || l.ledgerNo || l.debit > 0 || l.credit > 0,
      )
      .map((l) => ({
        sn: l.sn || undefined,
        particulars: l.particulars || undefined,
        account: l.account || undefined,
        ledgerNo: l.ledgerNo || undefined,
        debit: l.debit > 0 ? l.debit : undefined,
        credit: l.credit > 0 ? l.credit : undefined,
      }));

    for (const [i, pl] of resolvedPrintLines.entries()) {
      if ((pl.debit || pl.credit) && !(pl.particulars ?? "").trim()) {
        toast.error(
          `Print table line ${i + 1}: amount requires particulars`,
        );
        return;
      }
    }

    const payload: GoshwaraVoucherInput = {
      voucherType,
      dateBs,
      voucherNo: voucherNo.trim() || undefined,
      // Government header comes from Institution Settings (server re-resolves it too)
      govOfficeName: collegeNameNp || undefined,
      addressLine: collegeAddressNp || undefined,
      particulars: particulars.trim(),
      receiptNo: receiptNo.trim() || undefined,
      receivedAmount: receivedAmount.trim() || undefined,
      presenterName: presenterName.trim() || undefined,
      presenterRank: presenterRank.trim() || undefined,
      chequeNo: chequeNo.trim() || undefined,
      chequeAmount: chequeAmount.trim() || undefined,
      chequePresenter: chequePresenter.trim() || undefined,
      chequeDate: chequeDate.trim() || undefined,
      chequeRank: chequeRank.trim() || undefined,
      amountInWords: words,
      printLines: resolvedPrintLines,
      lines: lines.map((l) => ({
        accountCode: l.accountCode,
        accountName: l.accountName,
        debitNpr: Number(l.debitNpr) || 0,
        creditNpr: Number(l.creditNpr) || 0,
        description: (l.description ?? "").trim(),
      })),
    };
    createVoucher.mutate(payload);
  };

  const filteredEntries = useMemo(() => {
    const rows = entriesQuery.data ?? [];
    const q = ledgerSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((entry) => {
      const hay = [
        entry.voucherNumber,
        entry.narration,
        entry.voucherType,
        entry.dateBs,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [entriesQuery.data, ledgerSearch]);

  const vouchers = vouchersQuery.data ?? [];

  if (entriesQuery.isLoading) return <LoadingState />;

  const tabs: Array<{
    id: JournalPanelTab;
    label: string;
    icon: typeof BookOpen;
    hidden?: boolean;
  }> = [
    { id: "ledger", label: "Journal ledger", icon: BookOpen },
    { id: "create", label: "New voucher", icon: Plus, hidden: !canWrite },
    { id: "vouchers", label: "Goshwara list", icon: FileText },
  ];

  return (
    <div className="min-w-0 max-w-full space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <BookOpen className="h-5 w-5 shrink-0 text-brand-600" />
              Journal Entries
            </CardTitle>
            <p className="mt-0.5 text-sm text-slate-500">
              Ledger · गोश्वारा भौचर (म.ले.प.फा.नं. १०)
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {tabs
              .filter((t) => !t.hidden)
              .map(({ id, label, icon: Icon }) => (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={tab === id ? "default" : "outline"}
                  onClick={() => setTab(id)}
                >
                  <Icon className="mr-1.5 h-4 w-4" />
                  {label}
                </Button>
              ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={printingKey !== null}
              onClick={() => void openBlankForm()}
            >
              <Printer className="mr-1 h-4 w-4" />
              {printingKey === "blank-form" ? "Opening…" : "Blank form"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* ─── Journal ledger ─── */}
      {tab === "ledger" ? (
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">Journal ledger</CardTitle>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-9"
                value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
                placeholder="Search voucher, narration…"
              />
            </div>
          </CardHeader>
          <CardContent className="min-w-0 p-0 sm:p-6 sm:pt-0">
            {filteredEntries.length === 0 ? (
              <div className="px-6 pb-6">
                <EmptyState
                  title="No journal entries"
                  description={
                    ledgerSearch.trim()
                      ? "No entries match your search."
                      : "Create a Goshwara voucher or post fees/expenses to see entries here."
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto overscroll-x-contain">
                <Table className="min-w-[920px]">
                  <TableHead>
                    <tr>
                      <Th>Voucher</Th>
                      <Th>Date (BS / AD)</Th>
                      <Th>Type</Th>
                      <Th>Narration</Th>
                      <Th className="text-right">Debit</Th>
                      <Th className="text-right">Credit</Th>
                      <Th>Status</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {filteredEntries.map((entry) => {
                      const linked = voucherByJournalId.get(entry._id);
                      const dual = formatDualDateCell({ dateBs: entry.dateBs });
                      const printKey = linked
                        ? `voucher:${linked._id}:print`
                        : `journal:${entry._id}:print`;
                      const blankKey = linked
                        ? `voucher:${linked._id}:blank`
                        : `journal:${entry._id}:blank`;
                      return (
                        <tr key={entry._id} className="align-top">
                          <Td className="font-mono text-sm font-medium text-slate-900">
                            {entry.voucherNumber}
                          </Td>
                          <Td className="whitespace-nowrap text-sm">
                            <div className="font-medium text-slate-800">
                              {dual.primary}
                            </div>
                            {dual.secondary ? (
                              <div className="text-xs text-slate-500">
                                {dual.secondary}
                              </div>
                            ) : null}
                          </Td>
                          <Td>
                            <Badge className="bg-slate-100 font-normal text-slate-700">
                              {VOUCHER_TYPE_NP[entry.voucherType as VoucherType] ??
                                entry.voucherType}
                            </Badge>
                          </Td>
                          <Td
                            className="max-w-[220px] truncate text-sm text-slate-700"
                            title={entry.narration}
                          >
                            {entry.narration || "—"}
                          </Td>
                          <Td className="whitespace-nowrap text-right tabular-nums">
                            {formatCurrencyNpr(entry.totalDebitNpr)}
                          </Td>
                          <Td className="whitespace-nowrap text-right tabular-nums">
                            {formatCurrencyNpr(entry.totalCreditNpr)}
                          </Td>
                          <Td>
                            {entry.isReversal ? (
                              <Badge className="bg-slate-100 text-slate-700">
                                Reversal
                              </Badge>
                            ) : entry.isReversed ? (
                              <Badge className="bg-amber-50 text-amber-800">
                                Reversed
                              </Badge>
                            ) : (
                              <Badge className="bg-emerald-50 text-emerald-800">
                                Posted
                              </Badge>
                            )}
                          </Td>
                          <Td>
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                title="Print Goshwara voucher"
                                disabled={printingKey !== null}
                                onClick={() =>
                                  void (linked
                                    ? openVoucherPdf(linked._id)
                                    : openJournalGoshwara(entry._id))
                                }
                              >
                                <Printer className="mr-1 h-3.5 w-3.5" />
                                {printingKey === printKey ? "…" : "Print"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Blank form"
                                disabled={printingKey !== null}
                                onClick={() =>
                                  void (linked
                                    ? openVoucherPdf(linked._id, true)
                                    : openJournalGoshwara(entry._id, {
                                        blank: true,
                                      }))
                                }
                              >
                                {printingKey === blankKey ? "…" : "Blank"}
                              </Button>
                              {canDelete &&
                              !entry.isReversal &&
                              !entry.isReversed ? (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  title="Delete (reverse) — Super Admin / College Admin only"
                                  onClick={() => confirmDeleteJournal(entry)}
                                  disabled={reverse.isPending}
                                >
                                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                                  Delete
                                </Button>
                              ) : null}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ─── Create Goshwara voucher ─── */}
      {tab === "create" && canWrite ? (
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">
              New Goshwara voucher · गोश्वारा भौचर
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-5"
              lang="ne"
              onSubmit={submitVoucher}
            >
              {/*
                Header identity — official Nepal Government format, read-only.
                Both Nepali lines are pulled from Institution Settings so every
                government-format document prints the same header.
              */}
              <section className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <div className={cn(npInputClass, "text-center leading-relaxed")}>
                  <p className="text-[15px] font-bold text-slate-900">नेपाल सरकार</p>
                  <p className="mt-2 text-sm font-semibold text-slate-800">
                    {collegeNameNp ? `${collegeNameNp} कार्यालय` : "…………………… कार्यालय"}
                  </p>
                  <p className="text-sm font-semibold text-slate-800">
                    {collegeAddressNp || "……………………"}
                  </p>
                </div>
                <p className="text-center text-xs text-slate-500">
                  {collegeNameNp && collegeAddressNp
                    ? "From Institution Settings → College Name (Nepali) / College Address (Nepali)."
                    : "Set College Name (Nepali) and College Address (Nepali) under Institution Settings to complete this header."}
                </p>
              </section>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label="Voucher no. (गो. भी. नं.)">
                  <Input
                    lang="ne"
                    className={npInputClass}
                    value={voucherNo}
                    onChange={(e) => setVoucherNo(e.target.value)}
                    placeholder="Auto if empty"
                  />
                </FormField>
                <FormField label="Date (BS)">
                  <NepaliDateField value={dateBs} onChange={setDateBs} />
                </FormField>
                <FormField label="Voucher type">
                  <Select
                    value={voucherType}
                    onChange={(e) =>
                      setVoucherType(e.target.value as VoucherType)
                    }
                  >
                    {VOUCHER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {VOUCHER_TYPE_NP[t]} ({t})
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Amount in words (अक्षरेपी)">
                  <div className="flex gap-1">
                    <Input
                      lang="ne"
                      className={cn(npInputClass, "min-w-0")}
                      value={amountInWords}
                      onChange={(e) => setAmountInWords(e.target.value)}
                      placeholder="Auto from total"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={fillAmountInWords}
                    >
                      Auto
                    </Button>
                  </div>
                </FormField>
              </div>

              <FormField label="Narration / particulars *">
                <Textarea
                  lang="ne"
                  className={npInputClass}
                  value={particulars}
                  onChange={(e) => setParticulars(e.target.value)}
                  rows={2}
                  placeholder="Main description for the voucher"
                  required
                />
              </FormField>

              {/* Journal GL lines first (source of truth) */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Journal lines
                    </p>
                    <p className="text-xs text-slate-500">
                      Min. 2 lines · debit = credit · each line needs a reason
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      className={
                        totals.balanced
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-amber-50 text-amber-900"
                      }
                    >
                      {totals.balanced
                        ? "Balanced"
                        : `Out by ${formatCurrencyNpr(Math.abs(totals.debit - totals.credit))}`}
                    </Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setLines((prev) => [...prev, emptyLine()])}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add line
                    </Button>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <Table className="min-w-[720px]">
                    <TableHead>
                      <tr>
                        <Th>Account</Th>
                        <Th>Particular / reason *</Th>
                        <Th className="w-32">Debit</Th>
                        <Th className="w-32">Credit</Th>
                        <Th className="w-12" />
                      </tr>
                    </TableHead>
                    <TableBody>
                      {lines.map((line, index) => (
                        <tr key={index}>
                          <Td className="min-w-[180px]">
                            <Select
                              value={line.accountCode}
                              onChange={(e) =>
                                updateLine(index, {
                                  accountCode: e.target.value,
                                })
                              }
                              required
                            >
                              <option value="">Select account</option>
                              {activeAccounts.map((a) => (
                                <option key={a._id} value={a.code}>
                                  {a.code} — {a.nameNp || a.name}
                                </option>
                              ))}
                            </Select>
                          </Td>
                          <Td className="min-w-[200px]">
                            <Input
                              lang="ne"
                              className={npInputClass}
                              value={line.description ?? ""}
                              onChange={(e) =>
                                updateLine(index, {
                                  description: e.target.value,
                                })
                              }
                              required
                              placeholder="Reason (Nepali OK)"
                            />
                          </Td>
                          <Td>
                            <NumberInput
                              value={line.debitNpr || ""}
                              min={0}
                              step={0.01}
                              onChange={(e) =>
                                updateLine(index, {
                                  debitNpr: Number(e.target.value) || 0,
                                })
                              }
                            />
                          </Td>
                          <Td>
                            <NumberInput
                              value={line.creditNpr || ""}
                              min={0}
                              step={0.01}
                              onChange={(e) =>
                                updateLine(index, {
                                  creditNpr: Number(e.target.value) || 0,
                                })
                              }
                            />
                          </Td>
                          <Td>
                            {lines.length > 2 ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setLines((prev) =>
                                    prev.filter((_, i) => i !== index),
                                  )
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            ) : null}
                          </Td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-medium">
                        <Td colSpan={2} className="text-right text-slate-600">
                          Total
                        </Td>
                        <Td className="tabular-nums">
                          {formatCurrencyNpr(totals.debit)}
                        </Td>
                        <Td className="tabular-nums">
                          {formatCurrencyNpr(totals.credit)}
                        </Td>
                        <Td />
                      </tr>
                    </TableBody>
                  </Table>
                </div>
              </section>

              {/* Print table (optional override for PDF) */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Print table (PDF layout)
                    </p>
                    <p className="text-xs text-slate-500">
                      Optional — leave empty to use journal lines on print
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={copyJournalToPrintLines}
                    >
                      Copy from journal
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPrintLines((prev) => [...prev, emptyPrintLine()])
                      }
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Row
                    </Button>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <Table className="min-w-[800px]">
                    <TableHead>
                      <tr>
                        <Th className="w-14">S.N.</Th>
                        <Th>Particulars</Th>
                        <Th>Account</Th>
                        <Th className="w-24">Ledger no.</Th>
                        <Th className="w-28">Debit</Th>
                        <Th className="w-28">Credit</Th>
                        <Th className="w-10" />
                      </tr>
                    </TableHead>
                    <TableBody>
                      {printLines.map((row, index) => (
                        <tr key={index}>
                          <Td>
                            <Input
                              lang="ne"
                              className={npInputClass}
                              value={row.sn}
                              onChange={(e) =>
                                updatePrintLine(index, { sn: e.target.value })
                              }
                              placeholder={String(index + 1)}
                            />
                          </Td>
                          <Td className="min-w-[160px]">
                            <Input
                              lang="ne"
                              className={npInputClass}
                              value={row.particulars}
                              onChange={(e) =>
                                updatePrintLine(index, {
                                  particulars: e.target.value,
                                })
                              }
                              placeholder="Particulars"
                            />
                          </Td>
                          <Td className="min-w-[120px]">
                            <Input
                              lang="ne"
                              className={npInputClass}
                              value={row.account}
                              onChange={(e) =>
                                updatePrintLine(index, {
                                  account: e.target.value,
                                })
                              }
                              placeholder="Account"
                            />
                          </Td>
                          <Td>
                            <Input
                              lang="ne"
                              className={npInputClass}
                              value={row.ledgerNo}
                              onChange={(e) =>
                                updatePrintLine(index, {
                                  ledgerNo: e.target.value,
                                })
                              }
                            />
                          </Td>
                          <Td>
                            <NumberInput
                              value={row.debit || ""}
                              min={0}
                              onChange={(e) =>
                                updatePrintLine(index, {
                                  debit: Number(e.target.value) || 0,
                                })
                              }
                            />
                          </Td>
                          <Td>
                            <NumberInput
                              value={row.credit || ""}
                              min={0}
                              onChange={(e) =>
                                updatePrintLine(index, {
                                  credit: Number(e.target.value) || 0,
                                })
                              }
                            />
                          </Td>
                          <Td>
                            {printLines.length > 1 ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setPrintLines((prev) =>
                                    prev.filter((_, i) => i !== index),
                                  )
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            ) : null}
                          </Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              {/* Optional paper footer fields */}
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-900">
                    Receipt / presenter
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="Receipt no.">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={receiptNo}
                        onChange={(e) => setReceiptNo(e.target.value)}
                      />
                    </FormField>
                    <FormField label="Amount received">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={receivedAmount}
                        onChange={(e) => setReceivedAmount(e.target.value)}
                      />
                    </FormField>
                    <FormField label="Presented by">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={presenterName}
                        onChange={(e) => setPresenterName(e.target.value)}
                      />
                    </FormField>
                    <FormField label="Rank">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={presenterRank}
                        onChange={(e) => setPresenterRank(e.target.value)}
                      />
                    </FormField>
                  </div>
                </div>
                <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-900">Cheque</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="Cheque no.">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={chequeNo}
                        onChange={(e) => setChequeNo(e.target.value)}
                      />
                    </FormField>
                    <FormField label="Cheque amount">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={chequeAmount}
                        onChange={(e) => setChequeAmount(e.target.value)}
                      />
                    </FormField>
                    <FormField label="Presented by">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={chequePresenter}
                        onChange={(e) => setChequePresenter(e.target.value)}
                      />
                    </FormField>
                    <FormField label="Date / rank">
                      <div className="flex gap-2">
                        <Input
                          lang="ne"
                          className={cn(npInputClass, "min-w-0")}
                          value={chequeDate}
                          onChange={(e) => setChequeDate(e.target.value)}
                          placeholder="Date"
                        />
                        <Input
                          lang="ne"
                          className={cn(npInputClass, "min-w-0")}
                          value={chequeRank}
                          onChange={(e) => setChequeRank(e.target.value)}
                          placeholder="Rank"
                        />
                      </div>
                    </FormField>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                <Button
                  type="submit"
                  disabled={createVoucher.isPending || !totals.balanced}
                >
                  {createVoucher.isPending
                    ? "Saving…"
                    : "Save voucher & journal"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    resetForm();
                    setTab("ledger");
                  }}
                >
                  Cancel
                </Button>
                {!totals.balanced ? (
                  <span className="text-xs text-amber-700">
                    Balance debit and credit to enable save
                  </span>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {/* ─── Goshwara vouchers list ─── */}
      {tab === "vouchers" ? (
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">Goshwara vouchers</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 p-0 sm:p-6 sm:pt-0">
            {vouchers.length === 0 ? (
              <div className="px-6 pb-6">
                <EmptyState
                  title="No Goshwara vouchers yet"
                  description="Create a voucher from the New voucher tab."
                />
              </div>
            ) : (
              <div className="overflow-x-auto overscroll-x-contain">
                <Table className="min-w-[900px]">
                  <TableHead>
                    <tr>
                      <Th>Voucher no.</Th>
                      <Th>Date</Th>
                      <Th>Institute / office</Th>
                      <Th>Lines</Th>
                      <Th className="text-right">Amount</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {vouchers.map((v) => {
                      const dual = formatDualDateCell({ dateBs: v.dateBs });
                      return (
                        <tr key={v._id} className="align-top">
                          <Td className="font-mono text-sm font-medium">
                            {v.voucherNo}
                          </Td>
                          <Td className="whitespace-nowrap text-sm">
                            <div className="font-medium text-slate-800">
                              {dual.primary}
                            </div>
                            {dual.secondary ? (
                              <div className="text-xs text-slate-500">
                                {dual.secondary}
                              </div>
                            ) : null}
                          </Td>
                          <Td className="max-w-[160px] truncate text-sm">
                            {collegeNameNp ||
                              v.govOfficeName ||
                              v.instituteName ||
                              v.officeName ||
                              "—"}
                          </Td>
                          <Td className="max-w-sm text-sm">
                            <div className="space-y-1 font-nepali">
                              {(v.lines ?? []).length > 0
                                ? (v.lines ?? []).slice(0, 4).map((l, i) => (
                                    <div key={i} className="leading-snug">
                                      <span className="font-medium text-slate-800">
                                        {(l.description || "—").trim()}
                                      </span>
                                      <span className="text-xs text-slate-500">
                                        {" "}
                                        · {l.accountName}
                                        {(l.debitNpr ?? 0) > 0
                                          ? ` · Dr ${formatCurrencyNpr(l.debitNpr)}`
                                          : ""}
                                        {(l.creditNpr ?? 0) > 0
                                          ? ` · Cr ${formatCurrencyNpr(l.creditNpr)}`
                                          : ""}
                                      </span>
                                    </div>
                                  ))
                                : (
                                    <span className="text-slate-600">
                                      {v.particulars || "—"}
                                    </span>
                                  )}
                              {(v.lines ?? []).length > 4 ? (
                                <span className="text-xs text-slate-400">
                                  +{(v.lines ?? []).length - 4} more
                                </span>
                              ) : null}
                            </div>
                          </Td>
                          <Td className="whitespace-nowrap text-right tabular-nums font-medium">
                            {formatCurrencyNpr(v.totalAmount)}
                          </Td>
                          <Td>
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={printingKey !== null}
                                onClick={() => void openVoucherPdf(v._id)}
                              >
                                <Printer className="mr-1 h-3.5 w-3.5" />
                                {printingKey === `voucher:${v._id}:print`
                                  ? "…"
                                  : "Print"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={printingKey !== null}
                                onClick={() => void openVoucherPdf(v._id, true)}
                              >
                                {printingKey === `voucher:${v._id}:blank`
                                  ? "…"
                                  : "Blank"}
                              </Button>
                              {canDelete ? (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  title="Delete voucher — Super Admin / College Admin only"
                                  disabled={
                                    deleteGoshwara.isPending ||
                                    printingKey !== null
                                  }
                                  onClick={() => confirmDeleteGoshwara(v)}
                                >
                                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                                  {deleteGoshwara.isPending ? "…" : "Delete"}
                                </Button>
                              ) : null}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};
