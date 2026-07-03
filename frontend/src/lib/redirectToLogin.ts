import { resetAppShell } from "lib/resetAppShell";

export const redirectToLogin = (): void => {
  resetAppShell();

  if (window.location.pathname === "/login") {
    window.location.reload();
    return;
  }

  window.location.replace("/login");
};