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
  type VoucherType,
} from "@phit-erp/shared";
import { getTodayBs } from "@munatech/nepali-datepicker";
import { FileText, Plus, Printer, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";

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

/** Suggested defaults — user can clear or change freely (not forced on save/print) */
const SUGGESTED_INSTITUTE = "पब्लिक हिमाल इन्स्टिच्युट अफ टेक्नोलोजी";
const SUGGESTED_ADDRESS = "धनगढीमाई वडा नं. ३";

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

export const JournalEntriesPanel = ({ canWrite }: { canWrite: boolean }) => {
  const [showForm, setShowForm] = useState(false);

  // —— Manual header fields (printed as written) ——
  const [voucherNo, setVoucherNo] = useState("");
  const [govOfficeName, setGovOfficeName] = useState("");
  const [instituteName, setInstituteName] = useState(SUGGESTED_INSTITUTE);
  const [addressLine, setAddressLine] = useState(SUGGESTED_ADDRESS);
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
    setGovOfficeName("");
    setInstituteName(SUGGESTED_INSTITUTE);
    setAddressLine(SUGGESTED_ADDRESS);
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
      toast.success("जर्नल प्रविष्टि उल्ट्याइयो");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["journal-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["goshwara-vouchers"] }),
      ]);
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const createVoucher = useMutation({
    mutationFn: (payload: GoshwaraVoucherInput) =>
      unwrap<CreateVoucherResponse>(api.post("/accounting/goshwara-vouchers", payload)),
    onSuccess: async (data) => {
      toast.success(`भौचर ${data.voucher.voucherNo} सुरक्षित भयो`);
      resetForm();
      setShowForm(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["journal-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["goshwara-vouchers"] }),
      ]);
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const openJournalGoshwara = (
    journalId: string,
    opts?: { format?: "pdf" | "html"; blank?: boolean },
  ) => {
    const params = new URLSearchParams();
    if (opts?.format === "html") params.set("format", "html");
    if (opts?.blank) params.set("blank", "1");
    const qs = params.toString() ? `?${params}` : "";
    window.open(
      `${api.defaults.baseURL}/accounting/journal-entries/${journalId}/goshwara-voucher${qs}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const openVoucherPdf = (voucherId: string, blank = false) => {
    const qs = blank ? "?blank=1" : "";
    window.open(
      `${api.defaults.baseURL}/accounting/goshwara-vouchers/${voucherId}/pdf${qs}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const openBlankForm = () => {
    window.open(
      `${api.defaults.baseURL}/accounting/goshwara-vouchers/blank-form`,
      "_blank",
      "noopener,noreferrer",
    );
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
    toast.success("जर्नल लाइनहरू प्रिन्ट तालिकामा सारियो (सम्पादन गर्न सकिन्छ)");
  };

  /** Fill अक्षरेपी from journal debit total (Nepali words) */
  const fillAmountInWords = () => {
    if (totals.debit <= 0) {
      toast.error("पहिले जर्नलको जम्मा रकम राख्नुहोस्");
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
      toast.error("विवरण लेख्नुहोस्");
      return;
    }
    if (!totals.balanced) {
      toast.error("डेबिट र क्रेडिट जम्मा बराबर हुनुपर्छ");
      return;
    }
    for (const line of lines) {
      if (!line.accountCode) {
        toast.error("प्रत्येक जर्नल लाइनमा खाता छान्नुहोस्");
        return;
      }
      const d = Number(line.debitNpr) || 0;
      const c = Number(line.creditNpr) || 0;
      if ((d > 0 && c > 0) || (d <= 0 && c <= 0)) {
        toast.error("प्रत्येक लाइनमा डेबिट वा क्रेडिट मध्ये एउटा मात्र राख्नुहोस्");
        return;
      }
    }

    // Auto Nepali अक्षरेपी if user left it blank
    const words =
      amountInWords.trim() ||
      (totals.debit > 0 ? amountToWordsNepali(totals.debit) : undefined);

    const payload: GoshwaraVoucherInput = {
      voucherType,
      dateBs,
      voucherNo: voucherNo.trim() || undefined,
      govOfficeName: govOfficeName.trim() || undefined,
      instituteName: instituteName.trim() || undefined,
      addressLine: addressLine.trim() || undefined,
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
      printLines: printLines
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
        })),
      lines: lines.map((l) => ({
        accountCode: l.accountCode,
        accountName: l.accountName,
        debitNpr: Number(l.debitNpr) || 0,
        creditNpr: Number(l.creditNpr) || 0,
        description: l.description || particulars.trim(),
      })),
    };
    createVoucher.mutate(payload);
  };

  if (entriesQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      {canWrite ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex flex-col gap-0.5">
              <span className="font-nepali">गोश्वारा भौचर बनाउनुहोस्</span>
              <span className="text-sm font-normal text-muted-foreground font-nepali">
                म.ले.प.फा.नं. १० · सबै विवरण नेपालीमा लेख्न सकिन्छ
              </span>
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={openBlankForm}>
                <Printer className="mr-1 h-4 w-4" />
                खाली फारम
              </Button>
              <Button
                type="button"
                variant={showForm ? "outline" : "default"}
                size="sm"
                onClick={() => setShowForm((v) => !v)}
              >
                <Plus className="mr-1 h-4 w-4" />
                {showForm ? "लुकाउनुहोस्" : "नयाँ भौचर"}
              </Button>
            </div>
          </CardHeader>
          {showForm ? (
            <CardContent>
              <form className="space-y-6 font-nepali" lang="ne" onSubmit={submitVoucher}>
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  भौचरमा छापिने सबै लेखाइ नेपालीमा राख्नुहोस्। Windows: नेपाली कीबोर्ड (नेपाली) /
                  Preeti वा युनिकोड IME प्रयोग गर्नुहोस्।
                </p>

                {/* Header fields matching paper form */}
                <div className="rounded-xl border bg-slate-50 p-4 space-y-3">
                  <p className="text-center text-sm font-bold">नेपाल सरकार</p>
                  <div className="grid gap-3 md:grid-cols-3">
                    <FormField label="सरकारी कार्यालयको नाम (…कार्यालय)">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={govOfficeName}
                        onChange={(e) => setGovOfficeName(e.target.value)}
                        placeholder="नेपालीमा लेख्नुहोस्"
                      />
                    </FormField>
                    <FormField label="संस्थाको नाम (दोश्रो लाइन)">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={instituteName}
                        onChange={(e) => setInstituteName(e.target.value)}
                        placeholder={SUGGESTED_INSTITUTE}
                      />
                    </FormField>
                    <FormField label="ठेगाना (तेस्रो लाइन)">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={addressLine}
                        onChange={(e) => setAddressLine(e.target.value)}
                        placeholder={SUGGESTED_ADDRESS}
                      />
                    </FormField>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    छाप: नेपाल सरकार → [कार्यालय] कार्यालय → [संस्था] → [ठेगाना]
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <FormField label="गो. भी. नं.">
                    <Input
                      lang="ne"
                      className={npInputClass}
                      value={voucherNo}
                      onChange={(e) => setVoucherNo(e.target.value)}
                      placeholder="खाली = स्वतः नम्बर"
                    />
                  </FormField>
                  <FormField label="मिति (वि.सं.)">
                    <NepaliDateField value={dateBs} onChange={setDateBs} />
                  </FormField>
                  <FormField label="भौचर प्रकार">
                    <Select
                      value={voucherType}
                      onChange={(e) => setVoucherType(e.target.value as VoucherType)}
                    >
                      {VOUCHER_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {VOUCHER_TYPE_NP[t]}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="अक्षरेपी (नेपालीमा)">
                    <div className="flex gap-1">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={amountInWords}
                        onChange={(e) => setAmountInWords(e.target.value)}
                        placeholder="एक हजार रूपैयाँ …"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={fillAmountInWords}
                        title="जम्माबाट अक्षरेपी भर्नुहोस्"
                      >
                        स्वतः
                      </Button>
                    </div>
                  </FormField>
                </div>

                <FormField label="विवरण / कैफियत">
                  <Textarea
                    lang="ne"
                    className={npInputClass}
                    value={particulars}
                    onChange={(e) => setParticulars(e.target.value)}
                    rows={2}
                    placeholder="नेपालीमा विवरण लेख्नुहोस्"
                    required
                  />
                </FormField>

                {/* Free-text print table — Nepali */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      भौचर तालिका (विवरण / खाता / हि.नं. / डेबिट / क्रेडिट) — नेपालीमा
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={copyJournalToPrintLines}
                      >
                        जर्नलबाट सार्नुहोस्
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
                        पङ्क्ति थप्नुहोस्
                      </Button>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHead>
                        <tr>
                          <Th className="w-14">सि.नं.</Th>
                          <Th>विवरण</Th>
                          <Th>खाता</Th>
                          <Th className="w-24">हि. नं.</Th>
                          <Th className="w-28">डेबिट</Th>
                          <Th className="w-28">क्रेडिट</Th>
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
                            <Td>
                              <Input
                                lang="ne"
                                className={npInputClass}
                                value={row.particulars}
                                onChange={(e) =>
                                  updatePrintLine(index, {
                                    particulars: e.target.value,
                                  })
                                }
                                placeholder="नेपाली विवरण"
                              />
                            </Td>
                            <Td>
                              <Input
                                lang="ne"
                                className={npInputClass}
                                value={row.account}
                                onChange={(e) =>
                                  updatePrintLine(index, { account: e.target.value })
                                }
                                placeholder="खाताको नाम"
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
                  <p className="text-xs text-muted-foreground">
                    यो तालिका PDF मा छापिन्छ। खाली छोडेमा कागज जस्तै खाली कोठा रहन्छ।
                  </p>
                </div>

                {/* Journal GL — system accounts */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      लेखा प्रविष्टि (जर्नल) — कम्तीमा २ लाइन, डेबिट = क्रेडिट
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setLines((prev) => [...prev, emptyLine()])}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      लाइन थप्नुहोस्
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    यो भाग खाता किताब (ledger) का लागि हो — खाता सूचीबाट छान्नुहोस्।
                  </p>
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHead>
                        <tr>
                          <Th>खाता</Th>
                          <Th>डेबिट (रु.)</Th>
                          <Th>क्रेडिट (रु.)</Th>
                          <Th className="w-12" />
                        </tr>
                      </TableHead>
                      <TableBody>
                        {lines.map((line, index) => (
                          <tr key={index}>
                            <Td className="min-w-[220px]">
                              <Select
                                value={line.accountCode}
                                onChange={(e) =>
                                  updateLine(index, { accountCode: e.target.value })
                                }
                                required
                              >
                                <option value="">खाता छान्नुहोस्</option>
                                {activeAccounts.map((a) => (
                                  <option key={a._id} value={a.code}>
                                    {a.code} — {a.nameNp || a.name}
                                  </option>
                                ))}
                              </Select>
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
                        <tr className="bg-muted/40 font-medium">
                          <Td className="text-right">जम्मा</Td>
                          <Td>{formatCurrencyNpr(totals.debit)}</Td>
                          <Td>{formatCurrencyNpr(totals.credit)}</Td>
                          <Td>
                            {totals.balanced ? (
                              <span className="text-xs text-emerald-600">सन्तुलित</span>
                            ) : (
                              <span className="text-xs text-amber-600">असन्तुलित</span>
                            )}
                          </Td>
                        </tr>
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Bottom paper fields — all Nepali */}
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-sm font-medium">बायाँ (रसिद / पेश)</p>
                    <FormField label="रसिद नम्बर">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={receiptNo}
                        onChange={(e) => setReceiptNo(e.target.value)}
                        placeholder="नेपाली / अंक"
                      />
                    </FormField>
                    <FormField label="प्राप्त रकम">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={receivedAmount}
                        onChange={(e) => setReceivedAmount(e.target.value)}
                        placeholder="रु. …"
                      />
                    </FormField>
                    <FormField label="पेश गर्ने">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={presenterName}
                        onChange={(e) => setPresenterName(e.target.value)}
                        placeholder="नाम नेपालीमा"
                      />
                    </FormField>
                    <FormField label="दर्जा">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={presenterRank}
                        onChange={(e) => setPresenterRank(e.target.value)}
                        placeholder="पद / दर्जा"
                      />
                    </FormField>
                  </div>
                  <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-sm font-medium">दायाँ (चेक)</p>
                    <FormField label="चेक नं.">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={chequeNo}
                        onChange={(e) => setChequeNo(e.target.value)}
                      />
                    </FormField>
                    <FormField label="चेक रकम">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={chequeAmount}
                        onChange={(e) => setChequeAmount(e.target.value)}
                      />
                    </FormField>
                    <FormField label="पेश गर्ने">
                      <Input
                        lang="ne"
                        className={npInputClass}
                        value={chequePresenter}
                        onChange={(e) => setChequePresenter(e.target.value)}
                      />
                    </FormField>
                    <FormField label="मिति / दर्जा">
                      <div className="flex gap-2">
                        <Input
                          lang="ne"
                          className={npInputClass}
                          value={chequeDate}
                          onChange={(e) => setChequeDate(e.target.value)}
                          placeholder="मिति"
                        />
                        <Input
                          lang="ne"
                          className={npInputClass}
                          value={chequeRank}
                          onChange={(e) => setChequeRank(e.target.value)}
                          placeholder="दर्जा"
                        />
                      </div>
                    </FormField>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    disabled={createVoucher.isPending || !totals.balanced}
                  >
                    {createVoucher.isPending
                      ? "सुरक्षित हुँदै…"
                      : "भौचर + जर्नल सुरक्षित गर्नुहोस्"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      resetForm();
                      setShowForm(false);
                    }}
                  >
                    रद्द
                  </Button>
                </div>
              </form>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {(vouchersQuery.data ?? []).length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-nepali">गोश्वारा भौचर सूची</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHead>
                <tr>
                  <Th>गो. भी. नं.</Th>
                  <Th>मिति</Th>
                  <Th>संस्था / कार्यालय</Th>
                  <Th>विवरण</Th>
                  <Th>रकम</Th>
                  <Th>छाप्नुहोस्</Th>
                </tr>
              </TableHead>
              <TableBody>
                {(vouchersQuery.data ?? []).map((v) => (
                  <tr key={v._id}>
                    <Td className="font-mono text-sm">{v.voucherNo}</Td>
                    <Td>{v.dateBs}</Td>
                    <Td className="max-w-[180px] truncate text-sm">
                      {v.instituteName || v.govOfficeName || v.officeName || "—"}
                    </Td>
                    <Td className="max-w-xs truncate" title={v.particulars}>
                      {v.particulars}
                    </Td>
                    <Td>{formatCurrencyNpr(v.totalAmount)}</Td>
                    <Td>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openVoucherPdf(v._id)}
                        >
                          <Printer className="mr-1 h-3.5 w-3.5" />
                          छाप्नुहोस्
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="खाली फारम"
                          onClick={() => openVoucherPdf(v._id, true)}
                        >
                          खाली
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 font-nepali">
            <span>जर्नल प्रविष्टि (लेखा किताब)</span>
            <span className="text-sm font-normal text-muted-foreground">
              · गोश्वारा भौचर
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(entriesQuery.data ?? []).length === 0 ? (
            <EmptyState
              title="जर्नल प्रविष्टि छैन"
              description="माथिबाट गोश्वारा भौचर बनाउनुहोस्, वा शुल्क/खर्चबाट स्वतः आउने प्रविष्टि हेर्नुहोस्।"
            />
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <Th>भौचर</Th>
                  <Th>मिति</Th>
                  <Th>प्रकार</Th>
                  <Th>विवरण</Th>
                  <Th>डेबिट</Th>
                  <Th>क्रेडिट</Th>
                  <Th>कार्य</Th>
                </tr>
              </TableHead>
              <TableBody>
                {(entriesQuery.data ?? []).map((entry) => {
                  const linked = voucherByJournalId.get(entry._id);
                  return (
                    <tr key={entry._id}>
                      <Td className="font-mono text-sm">{entry.voucherNumber}</Td>
                      <Td>{entry.dateBs}</Td>
                      <Td>{entry.voucherType}</Td>
                      <Td className="max-w-xs truncate" title={entry.narration}>
                        {entry.narration}
                      </Td>
                      <Td>{formatCurrencyNpr(entry.totalDebitNpr)}</Td>
                      <Td>{formatCurrencyNpr(entry.totalCreditNpr)}</Td>
                      <Td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            title="गोश्वारा भौचर छाप्नुहोस्"
                            onClick={() =>
                              linked
                                ? openVoucherPdf(linked._id)
                                : openJournalGoshwara(entry._id, { format: "pdf" })
                            }
                          >
                            <FileText className="mr-1 h-3.5 w-3.5" />
                            छाप्नुहोस्
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="खाली फारम"
                            onClick={() =>
                              linked
                                ? openVoucherPdf(linked._id, true)
                                : openJournalGoshwara(entry._id, { blank: true })
                            }
                          >
                            खाली
                          </Button>
                          {canWrite && !entry.isReversal && !entry.isReversed ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => reverse.mutate(entry._id)}
                              disabled={reverse.isPending}
                            >
                              <RotateCcw className="mr-1 h-3.5 w-3.5" />
                              उल्ट्याउनुहोस्
                            </Button>
                          ) : entry.isReversal ? (
                            <span className="text-xs text-muted-foreground">
                              उल्टो प्रविष्टि
                            </span>
                          ) : entry.isReversed ? (
                            <span className="text-xs text-muted-foreground">
                              उल्ट्याइएको
                            </span>
                          ) : null}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
