import crypto from "node:crypto";
import type { Request } from "express";
import { INSTITUTION_NAME } from "@phit-erp/shared";
import { getAppLoginUrl, getPublicAppBaseUrl } from "../config/env.js";
import { EmailDeliveryLog } from "../models/EmailDeliveryLog.js";
import { User } from "../models/User.js";
import {
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

/** Admin toast/API message after portal login ID and/or password was updated. */
export const buildPortalCredentialsUpdatedMessage = (
  result: CredentialEmailResult,
  accountKind: CredentialAccountKind = "GENERAL"
): string => {
  const kind = accountKindLabel(accountKind);
  if (result.sent) {
    return `Login details updated. New credentials have been sent to the ${kind}: ${result.email}`;
  }

  if (result.skipped) {
    const reason = result.error ?? "Email skipped";
    return `Login details updated. Credential email was not sent. Reason: ${reason}`;
  }

  const reason = result.error ?? "Unknown error";
  return `Login details updated. Credential email could not be delivered. Reason: ${reason}`;
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
 * Prefer a calm, non-spammy subject. Same style for students, teachers, and staff
 * so all roles get equal Primary-inbox treatment. Avoid words like "password",
 * "credentials", ALL CAPS, or excessive punctuation.
 */
const buildWelcomeSubject = (kind?: CredentialAccountKind): string => {
  switch (kind) {
    case "STUDENT":
      return `${INSTITUTION_NAME}: your student portal account`;
    case "TEACHER":
      return `${INSTITUTION_NAME}: your teacher portal account`;
    case "PARENT":
      return `${INSTITUTION_NAME}: your parent portal account`;
    case "STAFF":
      return `${INSTITUTION_NAME}: your staff portal account`;
    case "ADMIN":
      return `${INSTITUTION_NAME}: your administrator portal account`;
    default:
      return `${INSTITUTION_NAME}: your portal account`;
  }
};

const buildLogoBlock = (params: {
  logoCid?: string;
  logoPublicUrl?: string;
  institution: string;
}): string => {
  // Prefer CID (inline, works without remote image load). Public HTTPS is fallback only.
  if (params.logoCid) {
    return `<img src="cid:${params.logoCid}" alt="${params.institution}" width="64" height="64" style="display:block;margin:0 0 12px;border:0;outline:none;text-decoration:none;" />`;
  }
  if (params.logoPublicUrl) {
    return `<img src="${escapeHtml(params.logoPublicUrl)}" alt="${params.institution}" width="64" height="64" style="display:block;margin:0 0 12px;border:0;outline:none;text-decoration:none;" />`;
  }
  return "";
};

/**
 * Personal, transactional layout (not a marketing newsletter).
 * Same template for students / teachers / staff so delivery is consistent.
 * High text-to-image ratio and a single CTA help Gmail Primary placement.
 */
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
  const roleLine = `Your ${kind} portal account at ${institution} is ready.`;
  const logoBlock = buildLogoBlock({
    logoCid: params.logoCid,
    logoPublicUrl: params.logoPublicUrl,
    institution
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>${institution} portal account</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Georgia,'Times New Roman',serif;color:#222222;">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#222222;">
    ${logoBlock}
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">Hello ${name},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
      ${roleLine}
      Please use the details below to sign in.
    </p>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.55;">
      <strong>Portal:</strong><br />
      <a href="${loginUrl}" style="color:#0c2d6b;word-break:break-all;">${loginUrl}</a>
    </p>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.55;">
      <strong>Login ID:</strong><br />
      ${email}
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
      <strong>Password:</strong><br />
      <span style="font-family:Consolas,Monaco,monospace;font-size:15px;">${accessCode}</span>
    </p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#444444;">
      Please change this password after your first sign-in and do not share it with others.
    </p>
    <p style="margin:0 0 20px;">
      <a href="${loginUrl}" style="display:inline-block;background:#0c2d6b;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:6px;">
        Open portal
      </a>
    </p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#444444;">
      If you have trouble signing in, contact the LMS administrator at your institution.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.55;">
      Regards,<br />
      ${institution}<br />
      LMS Administration
    </p>
  </div>
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

  return `Hello ${params.fullName},

Your ${kind} portal account at ${INSTITUTION_NAME} is ready. Please use the details below to sign in.

Portal:
${params.loginUrl}

Login ID:
${params.email}

Password:
${params.password}

Please change this password after your first sign-in and do not share it with others.

If you have trouble signing in, contact the LMS administrator at your institution.

Regards,
${INSTITUTION_NAME}
LMS Administration`;
};

const resolveLogoPublicUrl = (): string | undefined => {
  const base = getPublicAppBaseUrl();
  if (!base) return undefined;
  try {
    const url = new URL(base);
    // Never put localhost image URLs in outbound mail (broken + spammy)
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return undefined;
    }
  } catch {
    return undefined;
  }
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
        "Login ID is not a full email address, so no message was sent. Share the Login ID and Password with the user manually, or set a real email on the account."
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
  // Always prefer inline CID when we have a buffer — same path for students, teachers, staff
  const logoCid = logoAttachment?.cid;
  const logoPublicUrl = logoCid ? undefined : resolveLogoPublicUrl();

  const html = buildWelcomeEmailHtml({
    fullName: input.fullName,
    email,
    password: input.password,
    loginUrl,
    accountKind: input.accountKind,
    logoCid,
    logoPublicUrl
  });
  const text = buildWelcomeEmailText({
    fullName: input.fullName,
    email,
    password: input.password,
    loginUrl,
    accountKind: input.accountKind
  });

  // Same category family for every role so providers treat student mail like staff mail
  const delivery = await sendEmail({
    to: email,
    subject,
    html,
    text,
    category: "portal-account-welcome",
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
    ? `<p style="margin:0 0 16px;"><strong>Password:</strong><br /><span style="font-family:Consolas,Monaco,monospace;">${escapeHtml(params.password)}</span></p>`
    : `<p style="margin:0 0 16px;"><strong>Password:</strong><br />Your existing password was not changed.</p>`;

  const changeSummary = [
    params.loginIdChanged ? "login ID" : null,
    params.passwordChanged ? "password" : null
  ]
    .filter(Boolean)
    .join(" and ");

  const logoBlock = params.logoCid
    ? `<img src="cid:${params.logoCid}" alt="${institution}" width="64" height="64" style="display:block;margin:0 0 12px;border:0;outline:none;text-decoration:none;" />`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>Administrator access updated</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222222;">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px;font-size:15px;line-height:1.55;color:#222222;">
    ${logoBlock}
    <p style="margin:0 0 16px;">Hello ${name},</p>
    <p style="margin:0 0 16px;">
      Your administrator account ${changeSummary ? `${changeSummary} has` : "access has"} been updated by the Super Admin for ${institution} LMS.
      Please use the following details to sign in:
    </p>
    <p style="margin:0 0 8px;"><strong>Portal:</strong><br /><a href="${loginUrl}" style="color:#0c2d6b;word-break:break-all;">${loginUrl}</a></p>
    <p style="margin:0 0 8px;"><strong>Admin Login ID:</strong><br />${loginId}</p>
    ${passwordBlock}
    <p style="margin:16px 0;">
      <a href="${loginUrl}" style="display:inline-block;background:#0c2d6b;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:6px;">Open portal</a>
    </p>
    <p style="margin:0 0 16px;font-size:14px;color:#444444;">
      Keep this information private. If you did not expect this change, contact the Super Admin immediately.
    </p>
    <p style="margin:0;">
      Regards,<br />
      ${institution}<br />
      LMS Super Administration
    </p>
  </div>
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
    params.passwordChanged ? "password" : null
  ]
    .filter(Boolean)
    .join(" and ");

  const passwordSection = params.password
    ? `Password:
${params.password}`
    : `Password:
Your existing password was not changed.`;

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
  const subject = `${INSTITUTION_NAME}: administrator access updated`;
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
