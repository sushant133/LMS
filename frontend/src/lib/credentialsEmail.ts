import { toast } from "sonner";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";

export interface CredentialsEmailResult {
  sent: boolean;
  email: string;
  error?: string;
  skipped?: boolean;
  messageId?: string;
}

export interface CredentialCreatePayload {
  loginEmail?: string;
  defaultPassword?: string;
  credentialsEmail?: CredentialsEmailResult;
}

/**
 * Shows admin feedback after account creation based on email delivery status.
 */
export const toastCredentialCreateResult = (
  data: CredentialCreatePayload,
  options?: { successTitle?: string; fallbackTitle?: string }
): void => {
  const emailResult = data.credentialsEmail;
  const email = emailResult?.email ?? data.loginEmail;

  if (emailResult?.sent) {
    toast.success(options?.successTitle ?? "User created successfully", {
      description: `Login credentials have been sent to: ${email}`
    });
    return;
  }

  if (emailResult) {
    const passwordHint = data.defaultPassword
      ? `\nLogin ID: ${data.loginEmail ?? email}\nPassword: ${data.defaultPassword}`
      : "";
    toast.warning(options?.fallbackTitle ?? "User created successfully", {
      description: `Credential email could not be delivered.\nReason: ${emailResult.error ?? "Unknown error"}${passwordHint}`,
      duration: 15_000
    });
    return;
  }

  if (data.loginEmail) {
    toast.success(options?.successTitle ?? "User created with portal login", {
      description: data.defaultPassword
        ? `Login ID: ${data.loginEmail} · Password: ${data.defaultPassword}`
        : `Login ID: ${data.loginEmail}`
    });
    return;
  }

  toast.success(options?.successTitle ?? "User created successfully");
};

export const resendUserCredentials = async (
  userId: string,
  password?: string
): Promise<{
  loginEmail: string;
  defaultPassword: string;
  credentialsEmail: CredentialsEmailResult;
}> =>
  unwrap(api.post(`/users/${userId}/resend-credentials`, password ? { password } : {}));

export const toastResendCredentials = async (userId: string, password?: string): Promise<boolean> => {
  try {
    const result = await resendUserCredentials(userId, password);
    if (result.credentialsEmail?.sent) {
      toast.success("Credentials resent", {
        description: `Login credentials have been sent to: ${result.credentialsEmail.email}`
      });
      return true;
    }

    toast.warning("Could not deliver credential email", {
      description: result.credentialsEmail?.error ?? "Unknown error",
      duration: 10_000
    });
    return false;
  } catch (error) {
    toast.error(parseErrorMessage(error));
    return false;
  }
};

/**
 * Feedback after Super Admin updates an Administrator login ID and/or password.
 */
export const toastAdminCredentialsUpdated = (
  data: CredentialCreatePayload,
  options?: { successTitle?: string }
): void => {
  const emailResult = data.credentialsEmail;
  const email = emailResult?.email ?? data.loginEmail;
  const title = options?.successTitle ?? "Administrator credentials updated";

  if (emailResult?.sent) {
    toast.success(title, {
      description: `New login details have been emailed to: ${email}`
    });
    return;
  }

  if (emailResult) {
    const passwordHint = data.defaultPassword
      ? `\nLogin ID: ${data.loginEmail ?? email}\nPassword: ${data.defaultPassword}`
      : data.loginEmail
        ? `\nLogin ID: ${data.loginEmail}`
        : "";
    toast.warning(title, {
      description: `Notification email could not be delivered.\nReason: ${emailResult.error ?? "Unknown error"}${passwordHint}`,
      duration: 15_000
    });
    return;
  }

  toast.success(title, {
    description: data.loginEmail
      ? data.defaultPassword
        ? `Login ID: ${data.loginEmail} · Password: ${data.defaultPassword}`
        : `Login ID: ${data.loginEmail}`
      : undefined
  });
};

/**
 * Feedback after student/teacher portal login ID and/or password was updated and re-emailed.
 */
export const toastCredentialUpdateResult = (
  data: CredentialCreatePayload & { credentialsChanged?: boolean },
  options?: { successTitle?: string; noCredentialChangeTitle?: string }
): void => {
  if (!data.credentialsChanged && !data.credentialsEmail) {
    toast.success(options?.noCredentialChangeTitle ?? "Updated successfully");
    return;
  }

  const emailResult = data.credentialsEmail;
  const email = emailResult?.email ?? data.loginEmail;
  const title = options?.successTitle ?? "Login details updated";

  if (emailResult?.sent) {
    toast.success(title, {
      description: `Updated login credentials have been sent to: ${email}`
    });
    return;
  }

  if (emailResult) {
    const passwordHint = data.defaultPassword
      ? `\nLogin ID: ${data.loginEmail ?? email}\nPassword: ${data.defaultPassword}`
      : data.loginEmail
        ? `\nLogin ID: ${data.loginEmail}`
        : "";
    toast.warning(title, {
      description: `Credential email could not be delivered.\nReason: ${emailResult.error ?? "Unknown error"}${passwordHint}`,
      duration: 15_000
    });
    return;
  }

  toast.success(title, {
    description: data.loginEmail
      ? data.defaultPassword
        ? `Login ID: ${data.loginEmail} · Password: ${data.defaultPassword}`
        : `Login ID: ${data.loginEmail}`
      : undefined
  });
};
