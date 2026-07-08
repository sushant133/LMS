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

export const sendEmail = async (params: SendEmailParams): Promise<SendEmailResult> => {
  const mailer = getMailTransporter();

  if (!mailer) {
    return {
      sent: false,
      skipped: true,
      error: "SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS."
    };
  }

  try {
    const info = await mailer.sendMail({
      from: `"${env.SMTP_FROM_NAME}" <${env.SMTP_FROM_EMAIL || env.SMTP_USER}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      attachments: params.attachments
    });

    return {
      sent: true,
      messageId: info.messageId
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
