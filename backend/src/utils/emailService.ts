import crypto from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";

let transporter: Transporter | null = null;

export const isSmtpConfigured = (): boolean =>
  Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

const isGmailSmtp = (): boolean =>
  Boolean(env.SMTP_HOST?.toLowerCase().includes("gmail.com") || env.SMTP_HOST?.toLowerCase().includes("googlemail.com"));

export const getMailTransporter = (): Transporter | null => {
  if (!isSmtpConfigured()) {
    return null;
  }

  if (!transporter) {
    // Explicit SMTP transport options (avoids nodemailer overload picking a non-SMTP shape)
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST as string,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER as string,
        pass: env.SMTP_PASS as string
      },
      // Prefer STARTTLS on 587; Gmail/App passwords work best with this path
      requireTLS: !env.SMTP_SECURE && env.SMTP_PORT === 587,
      tls: {
        minVersion: "TLSv1.2"
      },
      connectionTimeout: 30_000,
      greetingTimeout: 20_000,
      socketTimeout: 40_000
    } as nodemailer.TransportOptions);
  }

  return transporter;
};

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional override; defaults to SMTP_FROM_EMAIL / SMTP_USER. */
  replyTo?: string;
  /**
   * Optional category for logging / provider classification
   * (e.g. account-credentials, notices). Not shown to recipients.
   */
  category?: string;
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: Buffer | string;
    cid?: string;
    contentType?: string;
    contentDisposition?: "inline" | "attachment";
  }>;
}

export interface SendEmailResult {
  sent: boolean;
  skipped?: boolean;
  messageId?: string;
  error?: string;
}

const resolveFromAddress = (): { name: string; address: string } => {
  const authUser = (env.SMTP_USER || "").trim().toLowerCase();
  const configuredFrom = (env.SMTP_FROM_EMAIL || "").trim().toLowerCase();

  // Gmail only allows sending as the authenticated account (unless "Send mail as" is set).
  // Mismatched From is a top reason free Gmail SMTP lands in Spam.
  const address = isGmailSmtp() && authUser ? authUser : configuredFrom || authUser;

  return {
    name: (env.SMTP_FROM_NAME || "PHIT LMS").trim() || "PHIT LMS",
    address
  };
};

/**
 * Build a stable Message-ID using the From domain when possible.
 * Random IDs without a real domain look more spam-like to filters.
 */
const buildMessageId = (fromAddress: string): string => {
  const domain = fromAddress.includes("@") ? fromAddress.split("@")[1]! : "localhost";
  const id = crypto.randomBytes(12).toString("hex");
  return `<${id}@${domain}>`;
};

/** Basic check before SMTP — synthetic student usernames without @ must not be mailed. */
export const isDeliverableEmailAddress = (value: string): boolean => {
  const email = value.trim().toLowerCase();
  // Practical check: local@domain.tld (rejects bare usernames used as student login IDs)
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
};

export const sendEmail = async (params: SendEmailParams): Promise<SendEmailResult> => {
  const mailer = getMailTransporter();

  if (!mailer) {
    return {
      sent: false,
      skipped: true,
      error: "SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS."
    };
  }

  const to = params.to.trim().toLowerCase();
  if (!isDeliverableEmailAddress(to)) {
    return {
      sent: false,
      skipped: true,
      error: `Recipient "${params.to}" is not a deliverable email address.`
    };
  }

  const from = resolveFromAddress();
  if (!from.address) {
    return {
      sent: false,
      skipped: true,
      error: "SMTP_FROM_EMAIL or SMTP_USER is required."
    };
  }

  const authUser = (env.SMTP_USER || "").trim().toLowerCase();
  if (authUser && from.address !== authUser && isGmailSmtp()) {
    console.warn(
      `[email] SMTP_FROM_EMAIL differs from SMTP_USER on Gmail — forcing From to ${authUser} for deliverability.`
    );
  }

  const replyTo = (params.replyTo || env.SMTP_REPLY_TO || from.address).trim();
  const messageId = buildMessageId(from.address);

  try {
    const info = await mailer.sendMail({
      from: {
        name: from.name,
        address: from.address
      },
      // Envelope must match authenticated user on Gmail
      envelope: {
        from: from.address,
        to: [to]
      },
      to,
      replyTo,
      subject: params.subject,
      // Multipart text + html improves Primary placement vs HTML-only
      text: params.text,
      html: params.html,
      messageId,
      date: new Date(),
      // Keep headers minimal and transactional — bulk/list headers push free inboxes to Spam/Promotions
      headers: {
        "X-Entity-Ref-ID": crypto.randomBytes(8).toString("hex"),
        "X-Auto-Response-Suppress": "OOF, AutoReply",
        ...(params.category ? { "X-PHIT-Category": params.category } : {})
      },
      priority: "normal",
      // Personal/transactional style (not bulk newsletter)
      encoding: "utf-8",
      attachments: params.attachments?.map((attachment) => ({
        filename: attachment.filename,
        path: attachment.path,
        content: attachment.content,
        cid: attachment.cid,
        contentType: attachment.contentType,
        contentDisposition:
          attachment.contentDisposition ?? (attachment.cid ? "inline" : "attachment"),
        ...(attachment.cid
          ? {
              contentTransferEncoding: "base64" as const,
              // Helps clients treat logo as related body part, not a download
              contentDisposition: "inline" as const
            }
          : {})
      }))
    });

    return {
      sent: true,
      messageId: info.messageId || messageId
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email delivery error";
    console.error("[email] Failed to send:", message);
    return {
      sent: false,
      error: message
    };
  }
};
