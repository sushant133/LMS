import crypto from "node:crypto";
import type { Request } from "express";
import { INSTITUTION_NAME } from "@phit-erp/shared";
import { env, getAppLoginUrl } from "../config/env.js";
import { EmailDeliveryLog } from "../models/EmailDeliveryLog.js";
import { User } from "../models/User.js";
import {
  COLLEGE_LOGO_EMAIL_CID,
  collegeLogoExists,
  getCollegeLogoEmailAttachment,
  getCollegeLogoPath
} from "./collegeLogo.js";
import { recordAudit } from "./audit.js";
import { isDeliverableEmailAddress, sendEmail } from "./emailService.js";

export interface CredentialEmailResult {
  sent: boolean;
  email: string;
  error?: string;
  messageId?: string;
  skipped?: boolean;
}

export type CredentialEmailType =
  | "ACCOUNT_CREDENTIALS"
  | "PASSWORD_RESET"
  | "ADMIN_CREDENTIALS_UPDATED"
  | "GENERAL";

/** Used only for friendly copy in the welcome email (not the SMTP subject spam keywords). */
export type CredentialAccountKind =
  | "STUDENT"
  | "TEACHER"
  | "STAFF"
  | "PARENT"
  | "ADMIN"
  | "GENERAL";

export interface NotifyCredentialsInput {
  userId: string;
  fullName: string;
  email: string;
  /** Plaintext access code to include in the email (must match what was stored/hashed). */
  password: string;
  schoolId?: string | null;
  /** Optional request for audit logging. */
  req?: Request;
  emailType?: CredentialEmailType;
  /** Helps personalize body copy (students vs staff). */
  accountKind?: CredentialAccountKind;
}

export interface NotifyAdminCredentialsUpdatedInput {
  userId: string;
  fullName: string;
  /** Destination address for the notification (admin login ID / email). */
  email: string;
  /** New or current login ID shown in the message. */
  loginId: string;
  /** Plaintext password when it was changed; omit when only login ID changed. */
  password?: string;
  loginIdChanged: boolean;
  passwordChanged: boolean;
  schoolId?: string | null;
  req?: Request;
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
    return `User created successfully. Login details have been sent to: ${result.email}`;
  }

  if (result.skipped) {
    const reason = result.error ?? "Email skipped";
    return `User created successfully. Login email was not sent. Reason: ${reason}`;
  }

  const reason = result.error ?? "Unknown error";
  return `User created successfully. Login email could not be delivered. Reason: ${reason}`;
};

export const buildAdminCredentialsUpdatedMessage = (result: CredentialEmailResult): string => {
  if (result.sent) {
    return `Administrator login details updated. Notification email sent to: ${result.email}`;
  }

  const reason = result.error ?? "Unknown error";
  return `Administrator login details updated. Notification email could not be delivered. Reason: ${reason}`;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const accountKindLabel = (kind?: CredentialAccountKind): string => {
  switch (kind) {
    case "STUDENT":
      return "student";
    case "TEACHER":
      return "teacher";
    case "STAFF":
      return "staff";
    case "PARENT":
      return "parent";
    case "ADMIN":
      return "administrator";
    default:
      return "user";
  }
};

/**
 * Prefer a calm, non-spammy subject. Avoid words like "password", "credentials",
 * "login details free", ALL CAPS, or excessive punctuation — those hurt inbox placement
 * especially for high-volume student enrollments.
 */
const buildWelcomeSubject = (kind?: CredentialAccountKind): string => {
  switch (kind) {
    case "STUDENT":
      return `${INSTITUTION_NAME} – Welcome to the student portal`;
    case "TEACHER":
      return `${INSTITUTION_NAME} – Welcome to the teacher portal`;
    case "PARENT":
      return `${INSTITUTION_NAME} – Welcome to the parent portal`;
    case "STAFF":
      return `${INSTITUTION_NAME} – Welcome to the staff portal`;
    case "ADMIN":
      return `${INSTITUTION_NAME} – Administrator portal access`;
    default:
      return `${INSTITUTION_NAME} – Welcome to PHIT LMS`;
  }
};

const buildWelcomeEmailHtml = (params: {
  fullName: string;
  email: string;
  password: string;
  loginUrl: string;
  accountKind?: CredentialAccountKind;
  logoCid?: string;
  logoPublicUrl?: string;
}): string => {
  const name = escapeHtml(params.fullName);
  const email = escapeHtml(params.email);
  const accessCode = escapeHtml(params.password);
  const loginUrl = escapeHtml(params.loginUrl);
  const institution = escapeHtml(INSTITUTION_NAME);
  const kind = accountKindLabel(params.accountKind);
  const roleLine =
    params.accountKind === "STUDENT"
      ? "Your student portal account is ready."
      : `Your ${kind} portal account is ready.`;

  // Prefer CID (works offline / without "display images"); public HTTPS URL is a fallback
  // for clients that strip related parts. Never use the huge raw file as a remote asset.
  let logoBlock: string;
  if (params.logoCid) {
    logoBlock = `<img src="cid:${params.logoCid}" alt="${institution}" width="72" height="72" style="display:block;margin:0 auto 12px;border:0;outline:none;text-decoration:none;border-radius:12px;" />`;
  } else if (params.logoPublicUrl) {
    logoBlock = `<img src="${escapeHtml(params.logoPublicUrl)}" alt="${institution}" width="72" height="72" style="display:block;margin:0 auto 12px;border:0;outline:none;text-decoration:none;border-radius:12px;" />`;
  } else {
    logoBlock = `<div style="width:72px;height:72px;margin:0 auto 12px;border-radius:12px;background:#0c2d6b;color:#ffffff;font-weight:700;font-size:22px;line-height:72px;text-align:center;">PHIT</div>`;
  }

  // Keep HTML simple: solid header color (not CSS gradients), limited markup, plain language.
  // Spam filters score complex HTML + large inline images poorly on high-volume student mail.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>Welcome to ${institution}</title>
</head>
<body style="margin:0;padding:0;background:#f3f6fb;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f6fb;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="background:#0c2d6b;padding:28px 24px;text-align:center;color:#ffffff;">
              ${logoBlock}
              <div style="font-size:18px;font-weight:700;letter-spacing:0.2px;">${institution}</div>
              <div style="margin-top:6px;font-size:13px;opacity:0.9;">Learning Management System</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px;">
              <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#0c2d6b;">Hello ${name},</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
                ${roleLine}
                You can sign in to PHIT LMS with the details below.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;margin-bottom:4px;">Portal link</div>
                    <div style="font-size:14px;word-break:break-all;margin-bottom:14px;">
                      <a href="${loginUrl}" style="color:#0c2d6b;text-decoration:none;font-weight:600;">${loginUrl}</a>
                    </div>
                    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;margin-bottom:4px;">Login ID</div>
                    <div style="font-size:15px;font-weight:600;margin-bottom:14px;color:#111827;">${email}</div>
                    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;margin-bottom:4px;">Temporary access code</div>
                    <div style="font-size:15px;font-weight:700;letter-spacing:0.03em;color:#111827;font-family:Consolas,Monaco,monospace;">${accessCode}</div>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">
                For your security, change this temporary access code after your first sign-in. Do not share it with others.
              </p>
              <div style="text-align:center;margin:24px 0 8px;">
                <a href="${loginUrl}" style="display:inline-block;background:#0c2d6b;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;">
                  Open PHIT LMS
                </a>
              </div>
              <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">
                If you have trouble signing in, contact the LMS administrator at your institution.
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
              This is an automated message from ${institution} LMS. Please keep your access code private.
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
  accountKind?: CredentialAccountKind;
}): string => {
  const kind = accountKindLabel(params.accountKind);
  const roleLine =
    params.accountKind === "STUDENT"
      ? "Your student portal account is ready."
      : `Your ${kind} portal account is ready.`;

  return `Hello ${params.fullName},

${roleLine}
You can sign in to PHIT LMS with the details below.

Portal link
${params.loginUrl}

Login ID
${params.email}

Temporary access code
${params.password}

For your security, change this temporary access code after your first sign-in. Do not share it with others.

If you have trouble signing in, contact the LMS administrator at your institution.

Regards,
${INSTITUTION_NAME}
LMS Administration`;
};

const resolveLogoPublicUrl = (): string | undefined => {
  const base =
    env.APP_URL?.trim() ||
    env.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .find(Boolean);
  if (!base) return undefined;
  // Frontend serves /college-logo.png from public/
  return `${base.replace(/\/$/, "")}/college-logo.png`;
};

/**
 * Sends a professional welcome / access email and logs delivery status.
 * Never throws — account creation must succeed even if email fails.
 */
export const notifyAccountCredentials = async (
  input: NotifyCredentialsInput
): Promise<CredentialEmailResult> => {
  const email = input.email.toLowerCase().trim();
  const loginUrl = getAppLoginUrl();
  const subject = buildWelcomeSubject(input.accountKind);
  const emailType = input.emailType ?? "ACCOUNT_CREDENTIALS";

  if (!isDeliverableEmailAddress(email)) {
    const result: CredentialEmailResult = {
      sent: false,
      email,
      skipped: true,
      error:
        "Login ID is not a full email address, so no message was sent. Share the portal access code with the user manually, or set a real email on the account."
    };
    try {
      await EmailDeliveryLog.create({
        schoolId: input.schoolId || null,
        userId: input.userId,
        recipientEmail: email,
        subject,
        emailType,
        status: "SKIPPED",
        errorMessage: result.error,
        triggeredByUserId: input.req?.user?.userId || null,
        metadata: {
          fullName: input.fullName,
          loginUrl,
          accountKind: input.accountKind ?? "GENERAL",
          reason: "invalid_recipient"
        }
      });
    } catch (error) {
      console.error("[email] Failed to log skipped delivery:", error);
    }
    return result;
  }

  const logoAttachment = await getCollegeLogoEmailAttachment();
  const logoCid = logoAttachment?.cid ?? (collegeLogoExists() ? COLLEGE_LOGO_EMAIL_CID : undefined);
  const logoPublicUrl = logoAttachment ? undefined : resolveLogoPublicUrl();

  const html = buildWelcomeEmailHtml({
    fullName: input.fullName,
    email,
    password: input.password,
    loginUrl,
    accountKind: input.accountKind,
    logoCid: logoAttachment ? logoCid : undefined,
    logoPublicUrl
  });
  const text = buildWelcomeEmailText({
    fullName: input.fullName,
    email,
    password: input.password,
    loginUrl,
    accountKind: input.accountKind
  });

  const delivery = await sendEmail({
    to: email,
    subject,
    html,
    text,
    category: `account-access-${(input.accountKind ?? "general").toLowerCase()}`,
    attachments: logoAttachment
      ? [
          {
            filename: logoAttachment.filename,
            content: logoAttachment.content,
            cid: logoAttachment.cid,
            contentType: logoAttachment.contentType,
            contentDisposition: logoAttachment.contentDisposition
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
        loginUrl,
        accountKind: input.accountKind ?? "GENERAL",
        logoAttached: Boolean(logoAttachment),
        logoPath: collegeLogoExists() ? getCollegeLogoPath() : null
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
        error: delivery.error,
        accountKind: input.accountKind ?? "GENERAL"
      }
    });
  }

  return result;
};

/**
 * Generates a new password, saves it (hashed via User pre-save), and emails access details.
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

  const roleToKind = (role: string): CredentialAccountKind => {
    switch (role) {
      case "STUDENT":
        return "STUDENT";
      case "TEACHER":
        return "TEACHER";
      case "PARENT":
        return "PARENT";
      case "COLLEGE_ADMIN":
      case "SUPER_ADMIN":
      case "PRINCIPAL":
        return "ADMIN";
      default:
        return "STAFF";
    }
  };

  const credentialsEmail = await notifyAccountCredentials({
    userId: user._id.toString(),
    fullName: user.fullName,
    email: user.email,
    password,
    schoolId: user.schoolId?.toString() ?? null,
    req: params.req,
    emailType: "PASSWORD_RESET",
    accountKind: roleToKind(user.role)
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

const buildAdminCredentialsUpdatedHtml = (params: {
  fullName: string;
  loginId: string;
  password?: string;
  loginIdChanged: boolean;
  passwordChanged: boolean;
  loginUrl: string;
  logoCid?: string;
}): string => {
  const name = escapeHtml(params.fullName);
  const loginId = escapeHtml(params.loginId);
  const loginUrl = escapeHtml(params.loginUrl);
  const institution = escapeHtml(INSTITUTION_NAME);
  const passwordBlock = params.password
    ? `<div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;margin-bottom:4px;">New temporary access code</div>
                    <div style="font-size:15px;font-weight:700;letter-spacing:0.03em;color:#111827;font-family:Consolas,Monaco,monospace;margin-bottom:14px;">${escapeHtml(params.password)}</div>`
    : `<div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;margin-bottom:4px;">Access code</div>
                    <div style="font-size:14px;color:#374151;margin-bottom:14px;">Your existing access code was not changed.</div>`;

  const changeSummary = [
    params.loginIdChanged ? "login ID" : null,
    params.passwordChanged ? "sign-in code" : null
  ]
    .filter(Boolean)
    .join(" and ");

  const logoBlock = params.logoCid
    ? `<img src="cid:${params.logoCid}" alt="${institution}" width="72" height="72" style="display:block;margin:0 auto 12px;border:0;outline:none;text-decoration:none;border-radius:12px;" />`
    : `<div style="width:72px;height:72px;margin:0 auto 12px;border-radius:12px;background:#0c2d6b;color:#ffffff;font-weight:700;font-size:22px;line-height:72px;text-align:center;">PHIT</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>Administrator access updated</title>
</head>
<body style="margin:0;padding:0;background:#f3f6fb;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f6fb;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="background:#0c2d6b;padding:28px 24px;text-align:center;color:#ffffff;">
              ${logoBlock}
              <div style="font-size:18px;font-weight:700;letter-spacing:0.2px;">${institution}</div>
              <div style="margin-top:6px;font-size:13px;opacity:0.9;">Administrator account notice</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px;">
              <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#0c2d6b;">Administrator access updated</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
                Hello <strong>${name}</strong>,
              </p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
                Your administrator account ${changeSummary ? `${changeSummary} has` : "access has"} been updated by the Super Admin for <strong>${institution}</strong> LMS.
              </p>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#374151;">
                Please use the following details to sign in:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;margin-bottom:4px;">Portal link</div>
                    <div style="font-size:14px;word-break:break-all;margin-bottom:14px;">
                      <a href="${loginUrl}" style="color:#0c2d6b;text-decoration:none;font-weight:600;">${loginUrl}</a>
                    </div>
                    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;margin-bottom:4px;">Admin Login ID</div>
                    <div style="font-size:15px;font-weight:600;margin-bottom:14px;color:#111827;">${loginId}</div>
                    ${passwordBlock}
                  </td>
                </tr>
              </table>
              <div style="text-align:center;margin:24px 0 8px;">
                <a href="${loginUrl}" style="display:inline-block;background:#0c2d6b;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;">
                  Open PHIT LMS
                </a>
              </div>
              <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">
                Keep this information private. If you did not expect this change, contact the Super Admin immediately.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 28px;">
              <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
                Regards,<br />
                <strong>${institution}</strong><br />
                LMS Super Administration
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:16px 24px;text-align:center;font-size:12px;color:#9ca3af;">
              This is an automated security notice from ${institution} LMS.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const buildAdminCredentialsUpdatedText = (params: {
  fullName: string;
  loginId: string;
  password?: string;
  loginIdChanged: boolean;
  passwordChanged: boolean;
  loginUrl: string;
}): string => {
  const changeSummary = [
    params.loginIdChanged ? "login ID" : null,
    params.passwordChanged ? "sign-in code" : null
  ]
    .filter(Boolean)
    .join(" and ");

  const passwordSection = params.password
    ? `New temporary access code
${params.password}`
    : `Access code
Your existing access code was not changed.`;

  return `Hello ${params.fullName},

Your administrator account ${changeSummary ? `${changeSummary} has` : "access has"} been updated by the Super Admin for ${INSTITUTION_NAME} LMS.

Please use the following details to sign in:

Portal link
${params.loginUrl}

Admin Login ID
${params.loginId}

${passwordSection}

Keep this information private. If you did not expect this change, contact the Super Admin immediately.

Regards,
${INSTITUTION_NAME}
LMS Super Administration`;
};

/**
 * Notifies an Administrator that Super Admin changed their login ID and/or password.
 * Never throws — credential updates must succeed even if email fails.
 */
export const notifyAdminCredentialsUpdated = async (
  input: NotifyAdminCredentialsUpdatedInput
): Promise<CredentialEmailResult> => {
  const email = input.email.toLowerCase().trim();
  const loginUrl = getAppLoginUrl();
  const subject = `${INSTITUTION_NAME} – Administrator access updated`;
  const emailType: CredentialEmailType = "ADMIN_CREDENTIALS_UPDATED";

  const logoAttachment = await getCollegeLogoEmailAttachment();

  const html = buildAdminCredentialsUpdatedHtml({
    fullName: input.fullName,
    loginId: input.loginId,
    password: input.password,
    loginIdChanged: input.loginIdChanged,
    passwordChanged: input.passwordChanged,
    loginUrl,
    logoCid: logoAttachment?.cid
  });
  const text = buildAdminCredentialsUpdatedText({
    fullName: input.fullName,
    loginId: input.loginId,
    password: input.password,
    loginIdChanged: input.loginIdChanged,
    passwordChanged: input.passwordChanged,
    loginUrl
  });

  const delivery = await sendEmail({
    to: email,
    subject,
    html,
    text,
    category: "admin-access-updated",
    attachments: logoAttachment
      ? [
          {
            filename: logoAttachment.filename,
            content: logoAttachment.content,
            cid: logoAttachment.cid,
            contentType: logoAttachment.contentType,
            contentDisposition: logoAttachment.contentDisposition
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
        loginId: input.loginId,
        loginIdChanged: input.loginIdChanged,
        passwordChanged: input.passwordChanged,
        loginUrl,
        logoAttached: Boolean(logoAttachment)
      }
    });
  } catch (error) {
    console.error("[email] Failed to log admin credentials update delivery:", error);
  }

  if (input.req) {
    await recordAudit(input.req, {
      action: delivery.sent
        ? "admin.credentials.email.sent"
        : "admin.credentials.email.failed",
      entity: "User",
      entityId: input.userId,
      after: {
        email,
        loginId: input.loginId,
        loginIdChanged: input.loginIdChanged,
        passwordChanged: input.passwordChanged,
        status: delivery.sent ? "SENT" : "FAILED",
        error: delivery.error
      }
    });
  }

  return result;
};
