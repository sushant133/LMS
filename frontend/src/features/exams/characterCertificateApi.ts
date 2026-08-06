import type {
  CharacterCertificateRecord,
  CharacterCertificateTemplateRecord,
  PassedOutStudentRecord,
} from "@phit-erp/shared";
import { api, unwrap } from "lib/api";

export const CERTIFICATE_API_BASE = "/character-certificates";

export const passedOutStudentsKey = (filters: {
  batchId: string;
  yearId: string;
  certificateStatus: string;
}) => ["passed-out-students", filters] as const;

export const certificateRecordsKey = (filters: { batchId: string; search: string }) =>
  ["character-certificates", filters] as const;

export const certificateTemplatesKey = () => ["character-certificate-templates"] as const;

export const fetchPassedOutStudents = (filters: {
  batchId: string;
  yearId: string;
  certificateStatus: string;
}) =>
  unwrap<PassedOutStudentRecord[]>(
    api.get(`${CERTIFICATE_API_BASE}/passed-out-students`, {
      params: {
        batchId: filters.batchId || undefined,
        yearId: filters.yearId || undefined,
        certificateStatus: filters.certificateStatus || undefined,
      },
    }),
  );

export const fetchCertificateRecords = (filters: { batchId: string; search: string }) =>
  unwrap<CharacterCertificateRecord[]>(
    api.get(CERTIFICATE_API_BASE, {
      params: {
        batchId: filters.batchId || undefined,
        search: filters.search.trim() || undefined,
      },
    }),
  );

export const fetchCertificateTemplates = () =>
  unwrap<CharacterCertificateTemplateRecord[]>(api.get(`${CERTIFICATE_API_BASE}/templates`));

export interface CertificatePreviewResponse {
  student: PassedOutStudentRecord & {
    fatherName?: string;
    motherName?: string;
    gender?: string;
    dateOfBirthBs?: string;
    address?: string;
  };
  programName: string;
  headingText: string;
  signatoryLabel: string;
  bodyTemplate: string;
  resolvedBody: string;
  certificateNumber: string | null;
}

export const previewCertificate = (payload: {
  studentId: string;
  templateId?: string;
  bodyTemplate?: string;
  conduct?: string;
  purpose?: string;
  remarks?: string;
  issueDateBs?: string;
}) =>
  unwrap<CertificatePreviewResponse>(api.post(`${CERTIFICATE_API_BASE}/preview`, payload));

/**
 * Fetch one issuance as a PDF blob. Read-only on the server — reprinting an
 * existing issuance never touches the record, so this is safe to call freely.
 */
const fetchCertificateBlob = async (
  certificateId: string,
  issueNumber?: number,
): Promise<Blob> => {
  const response = await api.get(`${CERTIFICATE_API_BASE}/${certificateId}/pdf`, {
    params: issueNumber ? { issueNumber } : undefined,
    responseType: "blob",
    // Puppeteer's first launch can be slow on a cold server.
    timeout: 120_000,
  });

  const raw = response.data as Blob;
  const contentType = `${String(response.headers["content-type"] ?? "")} ${raw.type || ""}`
    .toLowerCase();

  // Errors come back as JSON even when responseType is blob.
  if (contentType.includes("json")) {
    const text = await raw.text();
    let message = "Could not open the certificate";
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message || parsed.error || message;
    } catch {
      if (text.trim()) message = text.slice(0, 200);
    }
    throw new Error(message);
  }

  const pdfBlob =
    raw.type === "application/pdf" ? raw : new Blob([raw], { type: "application/pdf" });
  if (!pdfBlob.size) throw new Error("The certificate PDF came back empty");
  return pdfBlob;
};

/**
 * Hidden-iframe print. A `window.open` after an await gets caught by popup
 * blockers, so the app prints PDFs this way everywhere (see JournalEntriesPanel).
 */
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
        } catch (error) {
          cleanup();
          reject(error instanceof Error ? error : new Error("PDF print failed"));
        }
      }, 400);
    };

    iframe.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error("Could not load the certificate for print"));
    };

    iframe.src = url;
  });

/** Open the browser print dialog for an issuance. */
export const printCertificatePdf = async (
  certificateId: string,
  issueNumber?: number,
): Promise<void> => {
  const blob = await fetchCertificateBlob(certificateId, issueNumber);
  const url = URL.createObjectURL(blob);
  try {
    await printPdfBlobUrl(url);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
  }
};

/** Save an issuance as a PDF file. */
export const downloadCertificatePdf = async (
  certificateId: string,
  fileName: string,
  issueNumber?: number,
): Promise<void> => {
  const blob = await fetchCertificateBlob(certificateId, issueNumber);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
};
