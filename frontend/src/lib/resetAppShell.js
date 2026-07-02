export const resetAppShell = () => {
    const { body, documentElement } = document;
    body.style.overflow = "";
    body.style.paddingRight = "";
    body.style.position = "";
    body.style.top = "";
    body.style.left = "";
    body.style.right = "";
    body.style.width = "";
    body.style.height = "";
    documentElement.style.overflow = "";
    window.scrollTo({ top: 0, left: 0 });
};
