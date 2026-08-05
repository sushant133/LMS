import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LIBRARY_YEAR_LEVELS,
  type LibraryBookCopyRecord,
  type LibraryBookRecord,
  type LibraryCopyStatus,
  type LibraryYearLevel,
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
import { exportLibraryInventoryPdf } from "features/library/libraryUtils";
import { api, unwrap } from "lib/api";
import { getCollegeDisplayName } from "lib/auth";
import { getPrintInstitutionBranding } from "lib/printBranding";
import { printElementById } from "lib/printUtils";
import { parseErrorMessage } from "lib/utils";

const PRINT_AREA_ID = "library-print-books-area";

const copyStatusLabel: Record<LibraryCopyStatus, string> = {
  AVAILABLE: "Available",
  ISSUED: "Issued",
  LOST: "Lost",
  DAMAGED: "Damaged",
  MAINTENANCE: "Maintenance",
};

const formatPrice = (price?: number) => {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return "—";
  }
  return price.toLocaleString("en-NP");
};

type PrintBookBlockProps = {
  book: LibraryBookRecord;
  index: number;
};

/**
 * One book block for the print layout.
 * No forced page breaks between books — content flows continuously so book N+1
 * starts immediately after book N (no blank half-pages between titles).
 */
const PrintBookBlock = ({ book, index }: PrintBookBlockProps) => {
  const copies = book.copies ?? [];
  return (
    <section
      style={{
        marginBottom: 12,
        border: "1px solid #cbd5e1",
        padding: 10,
        // Continuous multi-book report: never force a new page after each book
        pageBreakAfter: "auto",
        breakAfter: "auto",
        pageBreakBefore: "auto",
        breakBefore: "auto",
        pageBreakInside: "auto",
        breakInside: "auto",
        color: "#0f172a",
        background: "#ffffff",
      }}
    >
      <div
        style={{
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ width: "100%" }}>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            Book {index + 1}
          </p>
          <h2
            style={{
              margin: "2px 0 6px",
              fontSize: 16,
              fontWeight: 700,
              color: "#0f172a",
            }}
          >
            {book.title}
          </h2>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
              color: "#334155",
              marginBottom: 4,
            }}
          >
            <tbody>
              <tr>
                <td style={{ padding: "2px 8px 2px 0", width: "50%" }}>
                  <strong>Author:</strong> {book.author || "—"}
                </td>
                <td style={{ padding: "2px 0" }}>
                  <strong>ISBN:</strong> {book.isbn?.trim() || "—"}
                </td>
              </tr>
              <tr>
                <td style={{ padding: "2px 8px 2px 0" }}>
                  <strong>Category:</strong> {book.category || "—"}
                </td>
                <td style={{ padding: "2px 0" }}>
                  <strong>Year level:</strong>{" "}
                  {book.yearLevel ?? "All Years"}
                </td>
              </tr>
              <tr>
                <td style={{ padding: "2px 8px 2px 0" }}>
                  <strong>Default shelf:</strong>{" "}
                  {book.shelfLocation?.trim() || "—"}
                </td>
                <td style={{ padding: "2px 0" }}>
                  <strong>Stock status:</strong> {book.status}
                </td>
              </tr>
              <tr>
                <td style={{ padding: "2px 8px 2px 0" }} colSpan={2}>
                  <strong>Copies:</strong> total {book.totalCopies} · available{" "}
                  {book.availableCopies} · issued {book.issuedCopies} · listed
                  codes {copies.length}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {copies.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "#92400e" }}>
          No coded physical copies registered for this title.
        </p>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            textAlign: "left",
            fontSize: 12,
            color: "#0f172a",
          }}
        >
          <thead style={{ display: "table-header-group" }}>
            <tr style={{ borderBottom: "1px solid #64748b", background: "#f1f5f9" }}>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>S.N.</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Book code</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Status</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>
                Shelf location
              </th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Condition</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>
                Publication
              </th>
              <th
                style={{
                  padding: "6px 8px",
                  fontWeight: 600,
                  textAlign: "right",
                }}
              >
                Price (NPR)
              </th>
            </tr>
          </thead>
          <tbody style={{ display: "table-row-group" }}>
            {copies.map((copy: LibraryBookCopyRecord, copyIndex: number) => (
              <tr
                key={copy._id}
                style={{
                  borderBottom: "1px solid #e2e8f0",
                  // Prefer keeping a single row intact; table may still span pages
                  pageBreakInside: "avoid",
                  breakInside: "avoid",
                }}
              >
                <td style={{ padding: "4px 8px", color: "#475569" }}>
                  {copyIndex + 1}
                </td>
                <td
                  style={{
                    padding: "4px 8px",
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 700,
                  }}
                >
                  {copy.bookCode}
                </td>
                <td style={{ padding: "4px 8px" }}>
                  {copyStatusLabel[copy.status] ?? copy.status}
                </td>
                <td style={{ padding: "4px 8px" }}>
                  {copy.shelfLocation?.trim() || "—"}
                </td>
                <td style={{ padding: "4px 8px" }}>
                  {copy.condition?.trim() || "—"}
                </td>
                <td style={{ padding: "4px 8px" }}>
                  {copy.publication?.trim() || "—"}
                </td>
                <td style={{ padding: "4px 8px", textAlign: "right" }}>
                  {formatPrice(copy.priceNpr)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};

export const LibraryPrintBooksPanel = () => {
  const { user, availableSchools } = useAuth();
  const printBranding = getPrintInstitutionBranding();
  const institutionName =
    getCollegeDisplayName(availableSchools, user) ||
    printBranding.name ||
    "Institution";
  const institutionAddress = printBranding.address?.trim() || "";

  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<"ALL" | LibraryYearLevel>("ALL");
  const [expandedBookId, setExpandedBookId] = useState<string | null>(null);
  const [printBooks, setPrintBooks] = useState<LibraryBookRecord[]>([]);
  const [printTitle, setPrintTitle] = useState("Library Book Inventory");
  const [printing, setPrinting] = useState(false);

  const booksQuery = useQuery({
    queryKey: ["library-books"],
    queryFn: () => unwrap<LibraryBookRecord[]>(api.get("/library/books")),
  });

  const filteredBooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    let books = booksQuery.data ?? [];
    if (yearFilter !== "ALL") {
      books = books.filter(
        (book) => (book.yearLevel ?? "All Years") === yearFilter,
      );
    }
    if (!q) return books;
    return books.filter((book) => {
      const year = (book.yearLevel ?? "All Years").toLowerCase();
      const inTitle =
        book.title.toLowerCase().includes(q) ||
        book.author.toLowerCase().includes(q) ||
        book.category.toLowerCase().includes(q) ||
        year.includes(q) ||
        (book.isbn ?? "").toLowerCase().includes(q) ||
        (book.shelfLocation ?? "").toLowerCase().includes(q);
      const inCodes = (book.copies ?? []).some((c) =>
        c.bookCode.toLowerCase().includes(q),
      );
      return inTitle || inCodes;
    });
  }, [booksQuery.data, search, yearFilter]);

  const totalCopies = useMemo(
    () =>
      filteredBooks.reduce(
        (sum, book) => sum + (book.copies?.length ?? book.totalCopies ?? 0),
        0,
      ),
    [filteredBooks],
  );

  const safeFilename = (name: string) =>
    name
      .replace(/[^\w\s\-().]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "library-inventory";

  const runPrint = async (
    books: LibraryBookRecord[],
    title: string,
    mode: "print" | "pdf" = "print",
  ): Promise<void> => {
    if (books.length === 0) {
      toast.error("No books to print");
      return;
    }
    setPrinting(true);
    // Commit print payload to the DOM before opening the print dialog
    flushSync(() => {
      setPrintBooks(books);
      setPrintTitle(title);
    });
    const onlyBook = books.length === 1 ? books[0] : undefined;
    try {
      const el = document.getElementById(PRINT_AREA_ID);
      // Use textContent — innerText is empty for display:none nodes
      if (!el || !el.textContent?.trim()) {
        throw new Error("Print content is empty — try again");
      }
      if (mode === "pdf") {
        const fileBase = onlyBook
          ? `library-book-${safeFilename(onlyBook.title)}`
          : "library-inventory-all-books";
        // jsPDF text layout — includes every book + every copy (no html2canvas clipping)
        await exportLibraryInventoryPdf(books, {
          institutionName,
          institutionAddress,
          title,
          filename: `${fileBase}.pdf`,
        });
        toast.success(
          onlyBook
            ? `PDF downloaded for “${onlyBook.title}” with all copies`
            : `PDF downloaded — ${books.length} books with full copy details`,
        );
      } else {
        await printElementById(PRINT_AREA_ID, "library-inventory-print");
        toast.success(
          onlyBook
            ? `Print dialog opened for “${onlyBook.title}”`
            : `Print dialog opened for ${books.length} books`,
        );
      }
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setPrinting(false);
    }
  };

  const allBooksTitle =
    yearFilter === "ALL"
      ? "Library Book Inventory — All Books"
      : `Library Book Inventory — ${yearFilter}`;

  const handlePrintOne = (book: LibraryBookRecord) => {
    void runPrint([book], `Library Book — ${book.title}`, "print");
  };

  const handlePdfOne = (book: LibraryBookRecord) => {
    void runPrint([book], `Library Book — ${book.title}`, "pdf");
  };

  const handlePrintAll = () => {
    void runPrint(filteredBooks, allBooksTitle, "print");
  };

  const handlePdfAll = () => {
    void runPrint(filteredBooks, allBooksTitle, "pdf");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Print books</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Print a single title with every physical copy and code, or print
              the full inventory with all books and copy details.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={handlePrintAll}
              disabled={printing || filteredBooks.length === 0}
            >
              <Printer className="mr-2 h-4 w-4" />
              {printing ? "Preparing…" : "Print all"}
            </Button>
            <Button
              onClick={handlePdfAll}
              disabled={printing || filteredBooks.length === 0}
            >
              {printing ? "Preparing…" : "Download PDF (all)"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="w-auto min-w-[140px]"
              value={yearFilter}
              onChange={(e) =>
                setYearFilter(e.target.value as "ALL" | LibraryYearLevel)
              }
            >
              <option value="ALL">All years</option>
              {LIBRARY_YEAR_LEVELS.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
            <Input
              className="max-w-sm"
              placeholder="Search title, author, category, or book code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <p className="text-sm text-slate-500">
              {filteredBooks.length} book
              {filteredBooks.length === 1 ? "" : "s"} · {totalCopies} cop
              {totalCopies === 1 ? "y" : "ies"}
            </p>
          </div>

          {booksQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Loading inventory…
            </p>
          ) : filteredBooks.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No books match this filter. Add books in Inventory first.
            </p>
          ) : (
            <div className="space-y-2">
              {filteredBooks.map((book, bookIndex) => {
                const expanded = expandedBookId === book._id;
                const copies = book.copies ?? [];
                return (
                  <div
                    key={book._id}
                    className="rounded-lg border border-slate-200"
                  >
                    <div className="flex w-full flex-wrap items-center gap-2 px-3 py-3">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-90"
                        onClick={() =>
                          setExpandedBookId(expanded ? null : book._id)
                        }
                      >
                        <span className="w-8 shrink-0 text-center text-sm tabular-nums text-slate-500">
                          {bookIndex + 1}
                        </span>
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-slate-900">
                              {book.title}
                            </p>
                            <Badge className="bg-indigo-100 text-indigo-800">
                              {book.yearLevel ?? "All Years"}
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-500">
                            {book.author} · {book.category} ·{" "}
                            {book.totalCopies} copies · {book.availableCopies}{" "}
                            available
                            {book.isbn ? ` · ISBN ${book.isbn}` : ""}
                          </p>
                        </div>
                        <StockStatusBadge status={book.status} />
                      </button>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={printing}
                          onClick={() => handlePrintOne(book)}
                        >
                          <Printer className="mr-1.5 h-3.5 w-3.5" />
                          Print
                        </Button>
                        <Button
                          size="sm"
                          disabled={printing}
                          onClick={() => handlePdfOne(book)}
                        >
                          PDF
                        </Button>
                      </div>
                    </div>
                    {expanded ? (
                      <div className="border-t border-slate-100 px-3 py-2">
                        {copies.length === 0 ? (
                          <p className="py-2 text-sm text-amber-700">
                            No coded copies yet for this title.
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <Table className="min-w-[720px]">
                              <TableHead>
                                <tr>
                                  <Th className="w-14 text-center">S.N.</Th>
                                  <Th>Book code</Th>
                                  <Th>Status</Th>
                                  <Th>Shelf</Th>
                                  <Th>Condition</Th>
                                  <Th>Publication</Th>
                                  <Th className="text-right">Price (NPR)</Th>
                                </tr>
                              </TableHead>
                              <TableBody>
                                {copies.map((copy, copyIndex) => (
                                  <tr key={copy._id}>
                                    <Td className="text-center tabular-nums text-slate-500">
                                      {copyIndex + 1}
                                    </Td>
                                    <Td className="font-mono font-medium">
                                      {copy.bookCode}
                                    </Td>
                                    <Td>
                                      {copyStatusLabel[copy.status] ??
                                        copy.status}
                                    </Td>
                                    <Td>
                                      {copy.shelfLocation?.trim() || "—"}
                                    </Td>
                                    <Td>{copy.condition?.trim() || "—"}</Td>
                                    <Td>
                                      {copy.publication?.trim() || "—"}
                                    </Td>
                                    <Td className="text-right tabular-nums">
                                      {formatPrice(copy.priceNpr)}
                                    </Td>
                                  </tr>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hidden print layout — cloned by printElementById (must not use off-screen fixed) */}
      <div
        id={PRINT_AREA_ID}
        className="hidden print:block"
        aria-hidden="true"
        style={{
          background: "#ffffff",
          color: "#0f172a",
          padding: 24,
          fontFamily:
            '"IBM Plex Sans", "Noto Sans Devanagari", "Nirmala UI", sans-serif',
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <header
            style={{
              marginBottom: 20,
              paddingBottom: 12,
              borderBottom: "1px solid #94a3b8",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <CollegeLogo className="h-14 w-14 shrink-0" />
              <div style={{ minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: 18,
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
                      fontSize: 12,
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
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#1e293b",
                  }}
                >
                  {printTitle}
                </p>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 12,
                    color: "#475569",
                  }}
                >
                  Library inventory report · {printBooks.length} book
                  {printBooks.length === 1 ? "" : "s"} ·{" "}
                  {printBooks.reduce(
                    (n, b) => n + (b.copies?.length ?? b.totalCopies ?? 0),
                    0,
                  )}{" "}
                  physical copies
                </p>
              </div>
            </div>
          </header>

          {printBooks.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
              No books selected to print.
            </p>
          ) : (
            <div
              style={{
                // Flow books one after another with no forced page gaps
                display: "block",
              }}
            >
              {printBooks.map((book, index) => (
                <PrintBookBlock key={book._id} book={book} index={index} />
              ))}
            </div>
          )}

          <footer
            style={{
              marginTop: 16,
              paddingTop: 10,
              borderTop: "1px solid #cbd5e1",
              fontSize: 11,
              color: "#64748b",
              pageBreakBefore: "auto",
              breakBefore: "auto",
            }}
          >
            <p style={{ margin: 0 }}>
              Library book inventory · Each row is one physical copy with its
              unique book code · Confidential institutional record
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
};
