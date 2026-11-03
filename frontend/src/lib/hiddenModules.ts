/**
 * Modules switched off for now. Their data and server APIs stay as they are — they are
 * only hidden from the menu, dashboard shortcuts, Module Access and their page route.
 * Remove a path here to bring the module back.
 */
const HIDDEN_PATHS = new Set<string>(["/hr"]);

/** Module Access keys of the hidden modules. */
const HIDDEN_MODULE_KEYS = new Set<string>(["hr"]);

export const isPathHidden = (path: string): boolean => HIDDEN_PATHS.has(path);

export const isModuleKeyHidden = (key: string): boolean => HIDDEN_MODULE_KEYS.has(key);
