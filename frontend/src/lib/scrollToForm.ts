/**
 * Bring an add / edit form into view after an Edit button fills it in.
 * Edit buttons usually sit in a list far from the form, so without this the
 * page stays put and the click looks like it did nothing.
 *
 * Waits two frames so a form that only mounts in edit mode exists first, and
 * leaves room for the sticky top bar.
 */
export const scrollToForm = (id: string) => {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const element = document.getElementById(id);
      if (!element) return;
      const topBar = document.querySelector<HTMLElement>(".app-topbar");
      const offset = (topBar?.offsetHeight ?? 0) + 16;
      const top = element.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }),
  );
};
