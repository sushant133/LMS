export const resetAppShell = (): void => {
  const { body, documentElement } = document;

  body.style.overflow = "";
  body.style.paddingRight = "";
  body.style.position = "";
  body.style.top = "";
  body.style.left = "";
  body.style.right = "";
  body.style.width = "";
  body.style.height = "";
  body.style.transform = "";
  documentElement.style.overflow = "";
  documentElement.style.height = "";
  documentElement.style.position = "";

  window.scrollTo({ top: 0, left: 0 });
};