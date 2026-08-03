import type {
  AttendanceRegisterCell,
  AttendanceRegisterResponse,
  AttendanceRegisterRowSummary,
} from "@phit-erp/shared";

export const REGISTER_CODE_COLORS: Record<string, string> = {
  P: "bg-emerald-100 text-emerald-800",
  A: "bg-red-100 text-red-800",
  L: "bg-blue-100 text-blue-800",
  Late: "bg-orange-100 text-orange-800",
  H: "bg-slate-200 text-slate-700",
  HD: "bg-amber-100 text-amber-900",
  OD: "bg-indigo-100 text-indigo-800",
  F: "bg-violet-100 text-violet-800",
  N: "bg-violet-100 text-violet-800",
  E: "bg-violet-100 text-violet-800",
  M: "bg-violet-100 text-violet-800",
};

export const REGISTER_CODE_PRINT_COLORS: Record<string, string> = {
  P: "#d1fae5",
  A: "#fee2e2",
  L: "#dbeafe",
  Late: "#ffedd5",
  H: "#e2e8f0",
  HD: "#fef3c7",
  OD: "#e0e7ff",
  F: "#ede9fe",
  N: "#ede9fe",
  E: "#ede9fe",
  M: "#ede9fe",
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const printCodeBg = (code: string): string =>
  REGISTER_CODE_PRINT_COLORS[code] ?? "#ffffff";

export const cellClass = (cell?: AttendanceRegisterCell | null): string => {
  if (!cell?.code) return "text-slate-300";
  return REGISTER_CODE_COLORS[cell.code] ?? "bg-slate-50 text-slate-700";
};

export const shiftMonthBs = (monthBs: string, delta: number): string => {
  const [y, m] = monthBs.split("-").map(Number);
  if (!y || !m) return monthBs;
  let year = y;
  let month = m + delta;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
};

export const summaryLine = (s: AttendanceRegisterRowSummary): string =>
  `P:${s.present} A:${s.absent} L:${s.leave} ${s.percentage}%`;

export const buildRegisterCsv = (data: AttendanceRegisterResponse): string => {
  const dayHeaders = data.days.map((d) => String(d.dayOfMonth));
  const header = [
    "SN",
    "Name",
    "Code",
    "Roll",
    "Department",
    "Designation",
    "Batch",
    "Year",
    ...dayHeaders,
    "Present",
    "Absent",
    "Leave",
    "Late",
    "Holiday",
    "Half Day",
    "Official Duty",
    "Field Duty",
    "Percentage",
  ];
  const lines = [header.join(",")];
  for (const row of data.rows) {
    const dayCells = data.days.map(
      (d) => row.cells[d.dateBs]?.code ?? "",
    );
    lines.push(
      [
        row.sn,
        csvEscape(row.fullName),
        csvEscape(row.code ?? ""),
        row.rollNumber ?? "",
        csvEscape(row.department ?? ""),
        csvEscape(row.designation ?? ""),
        csvEscape(row.batchName ?? row.className ?? ""),
        csvEscape(row.yearName ?? row.sectionName ?? ""),
        ...dayCells,
        row.summary.present,
        row.summary.absent,
        row.summary.leave,
        row.summary.late,
        row.summary.holiday,
        row.summary.halfDay,
        row.summary.officialDuty,
        row.summary.fieldDuty,
        row.summary.percentage,
      ].join(","),
    );
  }
  return lines.join("\n");
};

const csvEscape = (value: string): string => {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
};

export const downloadTextFile = (
  content: string,
  filename: string,
  mime: string,
): void => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export type RegisterPrintOptions = {
  appName: string;
  preparedBy?: string;
  /** e.g. STUDENT / TEACHER / STAFF */
  tabLabel?: string;
};

/**
 * Self-contained landscape register HTML for print / Save as PDF.
 * Does not rely on React DOM or Tailwind classes.
 */
export const buildAttendanceRegisterPrintHtml = (
  data: AttendanceRegisterResponse,
  options: RegisterPrintOptions,
): string => {
  const appName = escapeHtml(options.appName || "Attendance Register");
  const preparedBy = escapeHtml(options.preparedBy?.trim() || "—");
  const tabLabel = escapeHtml(
    options.tabLabel || data.tab || "Register",
  );
  const monthLabel = escapeHtml(data.monthLabel || data.monthBs || "");
  const scopeLabel = data.scopeLabel ? escapeHtml(data.scopeLabel) : "";
  const generated = escapeHtml(
    data.generatedAt
      ? new Date(data.generatedAt).toLocaleString()
      : new Date().toLocaleString(),
  );

  const dayHeaders = data.days
    .map((d) => {
      const sat = d.isSaturday ? ' class="sat"' : "";
      return `<th${sat}>${d.dayOfMonth}<br/><span class="wd">${escapeHtml(d.weekdayShort || "")}</span></th>`;
    })
    .join("");

  const bodyRows = data.rows
    .map((row) => {
      const dayCells = data.days
        .map((d) => {
          const code =
            row.cells[d.dateBs]?.code ?? (d.isSaturday ? "H" : "");
          const bg = code ? printCodeBg(code) : d.isSaturday ? "#e2e8f0" : "#fff";
          const sat = d.isSaturday ? " sat" : "";
          return `<td class="day${sat}" style="background:${bg}">${escapeHtml(code || "")}</td>`;
        })
        .join("");
      return `<tr>
        <td class="sn">${row.sn}</td>
        <td class="name">${escapeHtml(row.fullName)}</td>
        ${dayCells}
        <td class="sum">${row.summary.present}</td>
        <td class="sum">${row.summary.absent}</td>
        <td class="sum">${row.summary.leave}</td>
        <td class="sum">${row.summary.late}</td>
        <td class="sum pct">${row.summary.percentage}%</td>
      </tr>`;
    })
    .join("");

  const legend = (data.legend ?? [])
    .map(
      (l) =>
        `<span class="leg-item"><strong style="background:${printCodeBg(l.code)};padding:1px 4px;border-radius:3px">${escapeHtml(l.code)}</strong> ${escapeHtml(l.label)}</span>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Attendance Register — ${monthLabel}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 8mm 6mm;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      font-size: 9px;
      color: #0f172a;
      background: #fff;
    }
    h1 { font-size: 15px; margin: 0 0 2px; font-weight: 700; }
    h2 { font-size: 12px; margin: 0 0 6px; font-weight: 600; color: #334155; }
    .meta { margin-bottom: 8px; color: #475569; font-size: 9px; line-height: 1.4; }
    table {
      border-collapse: collapse;
      width: 100%;
      table-layout: auto;
    }
    th, td {
      border: 1px solid #94a3b8;
      padding: 1px 2px;
      text-align: center;
      vertical-align: middle;
    }
    th {
      background: #f1f5f9;
      font-size: 8px;
      font-weight: 600;
    }
    th .wd { font-weight: 500; color: #64748b; font-size: 7px; }
    td.name {
      text-align: left;
      white-space: nowrap;
      font-weight: 600;
      font-size: 9px;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    td.sn { width: 18px; font-size: 8px; color: #64748b; }
    td.day { min-width: 14px; width: 14px; font-size: 8px; font-weight: 600; }
    td.sum { font-size: 8px; min-width: 16px; }
    td.pct { font-weight: 700; }
    .sat { background: #e2e8f0 !important; }
    .legend { margin-top: 8px; font-size: 8px; color: #475569; line-height: 1.6; }
    .leg-item { margin-right: 10px; white-space: nowrap; }
    .footer {
      margin-top: 18px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    .sig {
      flex: 1;
      text-align: center;
      border-top: 1px solid #64748b;
      padding-top: 4px;
      margin-top: 28px;
      font-size: 9px;
      color: #334155;
    }
    .stats {
      margin: 4px 0 8px;
      font-size: 9px;
      color: #334155;
    }
    @page { size: A4 landscape; margin: 6mm; }
    @media print {
      body { padding: 0; }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>${appName}</h1>
  <h2>Attendance Register — ${tabLabel}</h2>
  <div class="meta">
    <strong>Month:</strong> ${monthLabel}${scopeLabel ? ` · <strong>Scope:</strong> ${scopeLabel}` : ""}
    <br />
    <strong>Generated:</strong> ${generated} · <strong>By:</strong> ${preparedBy}
    · <strong>People:</strong> ${data.rows.length} · <strong>Days:</strong> ${data.days.length}
  </div>
  <div class="stats">
    Present / Absent / Leave / Late columns are monthly totals · % = attendance percentage
  </div>
  <table>
    <thead>
      <tr>
        <th>SN</th>
        <th>Name</th>
        ${dayHeaders}
        <th>P</th>
        <th>A</th>
        <th>L</th>
        <th>Late</th>
        <th>%</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>
  <div class="legend">${legend || "P=Present · A=Absent · L=Leave · Late · H=Holiday"}</div>
  <div class="footer">
    <div class="sig">Prepared By<br/><span style="font-size:8px;color:#94a3b8">${preparedBy}</span></div>
    <div class="sig">Verified By</div>
    <div class="sig">Approved By</div>
  </div>
  <script>
    (function () {
      function go() {
        try { window.focus(); window.print(); } catch (e) {}
      }
      if (document.readyState === "complete") {
        setTimeout(go, 200);
      } else {
        window.addEventListener("load", function () { setTimeout(go, 200); });
      }
    })();
  </script>
</body>
</html>`;
};

/**
 * Open register print preview (auto print dialog).
 * Uses blob URL so onload/print works reliably (unlike document.write + noopener).
 */
export const openAttendanceRegisterPrint = (
  data: AttendanceRegisterResponse,
  options: RegisterPrintOptions,
): void => {
  const html = buildAttendanceRegisterPrintHtml(data, options);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  // Do NOT use noopener — some browsers return null and block writing.
  const win = window.open(url, "_blank");
  if (!win) {
    URL.revokeObjectURL(url);
    throw new Error("Popup blocked — allow popups to print the register");
  }
  // Auto-print once the document is ready
  const tryPrint = () => {
    try {
      win.focus();
      win.print();
    } catch {
      /* user can print manually from the tab */
    }
  };
  // Blob documents: listen for load; also fallback timer
  try {
    win.addEventListener("load", () => {
      window.setTimeout(tryPrint, 200);
    });
  } catch {
    /* ignore */
  }
  window.setTimeout(tryPrint, 600);
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
};

/**
 * Download register as PDF via html2pdf (landscape A4).
 */
export const downloadAttendanceRegisterPdf = async (
  data: AttendanceRegisterResponse,
  options: RegisterPrintOptions,
  filename: string,
): Promise<void> => {
  const html = buildAttendanceRegisterPrintHtml(data, options);
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "297mm";
  host.style.background = "#ffffff";
  host.setAttribute("aria-hidden", "true");
  // Parse body content for html2pdf (full document confuses html2pdf)
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  host.innerHTML = doc.body.innerHTML;
  // Re-apply critical styles on host for html2pdf
  const style = document.createElement("style");
  style.textContent = `
    #attendance-register-pdf-root, #attendance-register-pdf-root * { box-sizing: border-box; }
    #attendance-register-pdf-root { font-family: system-ui, sans-serif; font-size: 9px; color: #0f172a; padding: 6mm; }
    #attendance-register-pdf-root h1 { font-size: 15px; margin: 0 0 2px; }
    #attendance-register-pdf-root h2 { font-size: 12px; margin: 0 0 6px; color: #334155; }
    #attendance-register-pdf-root .meta { margin-bottom: 8px; color: #475569; font-size: 9px; }
    #attendance-register-pdf-root table { border-collapse: collapse; width: 100%; }
    #attendance-register-pdf-root th, #attendance-register-pdf-root td {
      border: 1px solid #94a3b8; padding: 1px 2px; text-align: center; font-size: 8px;
    }
    #attendance-register-pdf-root th { background: #f1f5f9; }
    #attendance-register-pdf-root td.name { text-align: left; white-space: nowrap; font-weight: 600; }
    #attendance-register-pdf-root .sat { background: #e2e8f0 !important; }
    #attendance-register-pdf-root .footer { margin-top: 18px; display: flex; justify-content: space-between; }
    #attendance-register-pdf-root .sig {
      flex: 1; text-align: center; border-top: 1px solid #64748b; padding-top: 4px; margin-top: 28px;
    }
    #attendance-register-pdf-root .legend { margin-top: 8px; font-size: 8px; color: #475569; }
  `;
  host.id = "attendance-register-pdf-root";
  document.body.appendChild(style);
  document.body.appendChild(host);

  try {
    const html2pdf = (await import("html2pdf.js")).default;
    const blob = (await html2pdf()
      .set({
        margin: [6, 6, 6, 6],
        filename,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
        },
        jsPDF: {
          unit: "mm",
          format: "a4",
          orientation: "landscape",
        },
        pagebreak: { mode: ["css", "legacy"] },
      } as never)
      .from(host)
      .outputPdf("blob")) as Blob;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } finally {
    host.remove();
    style.remove();
  }
};
