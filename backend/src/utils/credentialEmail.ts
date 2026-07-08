import crypto from "node:crypto";
import type { Request } from "express";
import { INSTITUTION_NAME } from "@phit-erp/shared";
import { env, getAppLoginUrl } from "../config/env.js";
import { EmailDeliveryLog } from "../models/EmailDeliveryLog.js";
import { User } from "../models/User.js";
import { collegeLogoExists, getCollegeLogoPath } from "./collegeLogo.js";
import { recordAudit } from "./audit.js";
import { sendEmail } from "./emailService.js";

export interface CredentialEmailResult {
  sent: boolean;
  email: string;
  error?: string;
  messageId?: string;
  skipped?: boolean;
}

export interface NotifyCredentialsInput {
  userId: string;
  fullName: string;
  email: string;
  /** Plaintext password to include in the email (must match what was stored/hashed). */
  password: string;
  schoolId?: string | null;
  /** Optional request for audit logging. */
  req?: Request;
  emailType?: "ACCOUNT_CREDENTIALS" | "PASSWORD_RESET";
}

/**
 * Resolves the portal password for a new account.
 * Admin-provided password is used as-is; otherwise a strong random password is generated.
 */
export const resolvePortalPassword = (
  adminPassword?: string | null
): { password: string; wasGenerated: boolean } => {
  const trimmed = adminPassword?.trim();
  if (trimmed) {
    return { password: trimmed, wasGenerated: false };
  }

  return {
    password: generateStrongPassword(),
    wasGenerated: true
  };
};

/** Strong random password: 12 chars, mixed upper/lower/digits/symbols (no ambiguous chars). */
export const generateStrongPassword = (length = 12): string => {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = upper + lower + digits + symbols;

  const pick = (charset: string) => charset[crypto.randomInt(0, charset.length)]!;

  const required = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  const rest = Array.from({ length: Math.max(length - required.length, 0) }, () => pick(all));
  const chars = [...required, ...rest];

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }

  return chars.join("");
};

export const buildCredentialsAdminMessage = (result: CredentialEmailResult): string => {
  if (result.sent) {
    return `User created successfully. Login credentials have been sent to: ${result.email}`;
  }

  const reason = result.error ?? "Unknown error";
  return `User created successfully. Credential email could not be delivered. Reason: ${reason}`;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildWelcomeEmailHtml = (params: {
  fullName: string;
  email: string;
  password: string;
  loginUrl: string;
  logoCid?: string;
}): string => {
  const name = escapeHtml(params.fullName);
  const email = escapeHtml(params.email);
  const password = escapeHtml(params.password);
  const loginUrl = escapeHtml(params.loginUrl);
  const institution = escapeHtml(INSTITUTION_NAME);
  const logoBlock = params.logoCid
    ? `<img src="cid:${params.logoCid}" alt="${institution}" width="72" height="72" style="display:block;margin:0 auto 12px;border-radius:12px;" />`
    : `<div style="width:72px;height:72px;margin:0 auto 12px;border-radius:12px;background:#0c2d6b;color:#fff;font-weight:700;font-size:22px;line-height:72px;text-align:center;">PHIT</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Welcome to PHIT LMS</title>
</head>
<body style="margin:0;padding:0;background:#f3f6fb;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fb;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(12,45,107,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0c2d6b,#1648a0);padding:28px 24px;text-align:center;color:#ffffff;">
              ${logoBlock}
              <div style="font-size:18px;font-weight:700;letter-spacing:0.2px;">${institution}</div>
              <div style="margin-top:6px;font-size:13px;opacity:0.9;">Learning Management System (LMS)</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px;">
              <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#0c2d6b;">Welcome, ${name}</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
                Welcome to <strong>PHIT LMS</strong>.
                Your account has been successfully created.
              </p>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#374151;">
                You can now access the LMS using the following credentials:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;margin-bottom:4px;">Login URL</div>
                    <div style="font-size:14px;word-break:break-all;margin-bottom:14px;">
                      <a href="${loginUrl}" style="color:#0c2d6b;text-decoration:none;font-weight:600;">${loginUrl}</a>
                    </div>
                    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;margin-bottom:4px;">Login ID (Email)</div>
                    <div style="font-size:15px;font-weight:600;margin-bottom:14px;color:#111827;">${email}</div>
                    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;margin-bottom:4px;">Password</div>
                    <div style="font-size:15px;font-weight:700;letter-spacing:0.03em;color:#111827;font-family:Consolas,Monaco,monospace;">${password}</div>
                  </td>
                </tr>
              </table>
              <div style="text-align:center;margin:24px 0 8px;">
                <a href="${loginUrl}" style="display:inline-block;background:#0c2d6b;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:999px;">
                  Login to LMS
                </a>
              </div>
              <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">
                If you experience any issues accessing your account, please contact the LMS Administrator.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 28px;">
              <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
                Regards,<br />
                <strong>${institution}</strong><br />
                LMS Administration
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:16px 24px;text-align:center;font-size:12px;color:#9ca3af;">
              This is an automated message from PHIT LMS. Please do not share your password with anyone.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const buildWelcomeEmailText = (params: {
  fullName: string;
  email: string;
  password: string;
  loginUrl: string;
}): string => `Hello ${params.fullName},

Welcome to PHIT LMS.

Your account has been successfully created.

You can now access the LMS using the following credentials:

Login URL
${params.loginUrl}

Login ID (Email)
${params.email}

Password
${params.password}

If you experience any issues accessing your account, please contact the LMS Administrator.

Regards,
${INSTITUTION_NAME}
LMS Administration`;

/**
 * Sends a professional welcome / credentials email and logs delivery status.
 * Never throws — account creation must succeed even if email fails.
 */
export const notifyAccountCredentials = async (
  input: NotifyCredentialsInput
): Promise<CredentialEmailResult> => {
  const email = input.email.toLowerCase().trim();
  const loginUrl = getAppLoginUrl();
  const subject = "Welcome to PHIT LMS – Your Login Credentials";
  const emailType = input.emailType ?? "ACCOUNT_CREDENTIALS";
  const logoCid = "college-logo";
  const includeLogo = collegeLogoExists();

  const html = buildWelcomeEmailHtml({
    fullName: input.fullName,
    email,
    password: input.password,
    loginUrl,
    logoCid: includeLogo ? logoCid : undefined
  });
  const text = buildWelcomeEmailText({
    fullName: input.fullName,
    email,
    password: input.password,
    loginUrl
  });

  const delivery = await sendEmail({
    to: email,
    subject,
    html,
    text,
    attachments: includeLogo
      ? [
          {
            filename: "college-logo.png",
            path: getCollegeLogoPath(),
            cid: logoCid,
            contentType: "image/png"
          }
        ]
      : undefined
  });

  const result: CredentialEmailResult = {
    sent: delivery.sent,
    email,
    error: delivery.error,
    messageId: delivery.messageId,
    skipped: delivery.skipped
  };

  try {
    await EmailDeliveryLog.create({
      schoolId: input.schoolId || null,
      userId: input.userId,
      recipientEmail: email,
      subject,
      emailType,
      status: delivery.sent ? "SENT" : delivery.skipped ? "SKIPPED" : "FAILED",
      errorMessage: delivery.error,
      messageId: delivery.messageId,
      triggeredByUserId: input.req?.user?.userId || null,
      metadata: {
        fullName: input.fullName,
        loginUrl
      }
    });
  } catch (error) {
    console.error("[email] Failed to log delivery:", error);
  }

  if (input.req) {
    await recordAudit(input.req, {
      action: delivery.sent ? "credentials.email.sent" : "credentials.email.failed",
      entity: "User",
      entityId: input.userId,
      after: {
        email,
        status: delivery.sent ? "SENT" : "FAILED",
        error: delivery.error
      }
    });
  }

  return result;
};

/**
 * Generates a new password, saves it (hashed via User pre-save), and emails credentials.
 */
export const resendAccountCredentials = async (params: {
  userId: string;
  password?: string;
  req?: Request;
}): Promise<{
  user: { _id: string; fullName: string; email: string; role: string };
  password: string;
  credentialsEmail: CredentialEmailResult;
}> => {
  const user = await User.findById(params.userId);
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  if (!user.isActive) {
    throw new Error("USER_INACTIVE");
  }

  const { password } = resolvePortalPassword(params.password);
  user.password = password;
  user.mustChangePassword = true;
  await user.save();

  const credentialsEmail = await notifyAccountCredentials({
    userId: user._id.toString(),
    fullName: user.fullName,
    email: user.email,
    password,
    schoolId: user.schoolId?.toString() ?? null,
    req: params.req,
    emailType: "PASSWORD_RESET"
  });

  return {
    user: {
      _id: user._id.toString(),
      fullName: user.fullName,
      email: user.email,
      role: user.role
    },
    password,
    credentialsEmail
  };
};


