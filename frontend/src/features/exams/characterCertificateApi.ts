import type {
  CharacterCertificateDetails,
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
  affiliationText: string;
  bodyTemplate: string;
  resolvedBody: string;
  certificateNumber: string | null;
}

export const previewCertificate = (
  payload: {
    studentId: string;
    templateId?: string;
    bodyTemplate?: string;
    conduct?: string;
    purpose?: string;
    remarks?: string;
    issueDateBs?: string;
  } & CharacterCertificateDetails,
) => unwrap<CertificatePreviewResponse>(api.post(`${CERTIFICATE_API_BASE}/preview`, payload));

type BlobResponse = { data: unknown; headers: Record<string, unknown> };

/** Errors come back as JSON even when responseType is blob, so unwrap by type. */
const toPdfBlob = async (response: BlobResponse): Promise<Blob> => {
  const raw = response.data as Blob;
  const contentType = `${String(response.headers["content-type"] ?? "")} ${raw.type || ""}`
    .toLowerCase();

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
 * On a non-2xx, axios rejects before `toPdfBlob` ever runs and the JSON error
 * body arrives as an unread Blob — which `parseErrorMessage` cannot see, so the
 * real reason ("Chromium is not available on the server") used to surface as a
 * bare "Something went wrong". Read the blob back into a proper Error.
 */
const asReadableError = async (error: unknown): Promise<Error> => {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    const text = (await data.text()).trim();
    if (text) {
      let message = "";
      try {
        const parsed = JSON.parse(text) as { message?: string; error?: string };
        message = parsed.message || parsed.error || "";
      } catch {
        message = text.slice(0, 300);
      }
      if (message) return new Error(message);
    }
  }
  return error instanceof Error ? error : new Error("Could not open the certificate");
};

/**
 * Fetch one issuance as a PDF blob. Read-only on the server — reprinting an
 * existing issuance never touches the record, so this is safe to call freely.
 */
const fetchCertificateBlob = async (
  certificateId: string,
  issueNumber?: number,
): Promise<Blob> => {
  try {
    return toPdfBlob(
      await api.get(`${CERTIFICATE_API_BASE}/${certificateId}/pdf`, {
        params: issueNumber ? { issueNumber } : undefined,
        responseType: "blob",
        // Puppeteer's first launch can be slow on a cold server.
        timeout: 120_000,
      }),
    );
  } catch (error) {
    throw await asReadableError(error);
  }
};

export type CertificateDraftPayload = CharacterCertificateDetails & {
  studentId: string;
  resolvedBody: string;
  headingText?: string;
  signatoryLabel?: string;
  affiliationText?: string;
  conduct?: string;
  issueDateBs?: string;
  isDuplicate?: boolean;
};

/**
 * Render the certificate exactly as it would print, from values that have not
 * been saved. Nothing is written, so the admin can check the sheet before a
 * certificate number is committed.
 */
const fetchCertificateDraftBlob = async (payload: CertificateDraftPayload): Promise<Blob> => {
  try {
    return toPdfBlob(
      await api.post(`${CERTIFICATE_API_BASE}/preview/pdf`, payload, {
        responseType: "blob",
        timeout: 120_000,
      }),
    );
  } catch (error) {
    throw await asReadableError(error);
  }
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

const saveBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
};

/** Save an issuance as a PDF file. */
export const downloadCertificatePdf = async (
  certificateId: string,
  fileName: string,
  issueNumber?: number,
): Promise<void> => {
  saveBlob(await fetchCertificateBlob(certificateId, issueNumber), fileName);
};

/** Open a draft of the unsaved edits in a new tab. */
export const openCertificateDraft = async (payload: CertificateDraftPayload): Promise<void> => {
  const blob = await fetchCertificateDraftBlob(payload);
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank");
  if (!opened) {
    // Popup blocked — fall back to a download so the draft is never lost.
    saveBlob(blob, "character-certificate-draft");
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
};

/** Save a draft of the unsaved edits as a PDF file. */
export const downloadCertificateDraft = async (
  payload: CertificateDraftPayload,
  fileName: string,
): Promise<void> => {
  saveBlob(await fetchCertificateDraftBlob(payload), fileName);
};
