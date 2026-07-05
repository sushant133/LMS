const DEMO_DISPLAY_NAME_REPLACEMENTS: Record<string, string> = {
  "Demo College Administrator": "College Administrator",
  "Demo Administrator": "College Administrator",
  "Demo Teacher": "Teacher",
  "Demo Student": "Student",
  "Demo Parent": "Parent",
  "Demo Accountant": "Accountant"
};

/** Strips legacy demo prefixes from user-facing display names without changing login IDs. */
export const sanitizeUserDisplayName = (fullName: string): string => {
  const trimmed = fullName.trim();
  const exact = DEMO_DISPLAY_NAME_REPLACEMENTS[trimmed];
  if (exact) {
    return exact;
  }

  const insensitive = Object.entries(DEMO_DISPLAY_NAME_REPLACEMENTS).find(
    ([key]) => key.toLowerCase() === trimmed.toLowerCase()
  );
  if (insensitive) {
    return insensitive[1];
  }

  if (/^demo\s+/i.test(trimmed)) {
    return trimmed.replace(/^demo\s+/i, "");
  }

  return trimmed;
};