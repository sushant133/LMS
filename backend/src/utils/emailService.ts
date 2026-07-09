import crypto from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";

let transporter: Transporter | null = null;

export const isSmtpConfigured = (): boolean =>
  Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

export const getMailTransporter = (): Transporter | null => {
  if (!isSmtpConfigured()) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS
      },
      // Prefer STARTTLS on 587; Gmail/App passwords work best with this path
      requireTLS: !env.SMTP_SECURE && env.SMTP_PORT === 587,
      tls: {
        minVersion: "TLSv1.2"
      }
    });
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
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: Buffer | string;
    cid?: string;
    contentType?: string;
  }>;
}

export interface SendEmailResult {
  sent: boolean;
  skipped?: boolean;
  messageId?: string;
  error?: string;
}

const resolveFromAddress = (): { name: string; address: string } => {
  const address = (env.SMTP_FROM_EMAIL || env.SMTP_USER || "").trim().toLowerCase();
  return {
    name: env.SMTP_FROM_NAME || "PHIT LMS",
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

export const sendEmail = async (params: SendEmailParams): Promise<SendEmailResult> => {
  const mailer = getMailTransporter();

  if (!mailer) {
    return {
      sent: false,
      skipped: true,
      error: "SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS."
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

  // Gmail rejects or spam-scores mismatched From vs authenticated user
  const authUser = (env.SMTP_USER || "").trim().toLowerCase();
  if (authUser && from.address !== authUser && env.SMTP_HOST?.includes("gmail.com")) {
    console.warn(
      `[email] SMTP_FROM_EMAIL (${from.address}) differs from SMTP_USER (${authUser}). ` +
        "With Gmail, From must match the authenticated account or messages often land in spam."
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
      to: params.to,
      replyTo,
      subject: params.subject,
      // Multipart text + html (nodemailer) improves deliverability vs HTML-only
      text: params.text,
      html: params.html,
      messageId,
      // Help mailbox providers classify as transactional, not bulk marketing
      headers: {
        "X-Entity-Ref-ID": crypto.randomBytes(8).toString("hex"),
        "X-Mailer": "PHIT-LMS",
        "X-Auto-Response-Suppress": "OOF, AutoReply",
        Precedence: "auto_reply",
        "Auto-Submitted": "auto-generated"
      },
      attachments: params.attachments
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
