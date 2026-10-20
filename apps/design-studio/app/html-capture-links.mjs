// Keep authored link selectors during static capture without enabling navigation.
export function isHtmlAnchorHref(element, name) {
  return (
    element.namespaceURI === "http://www.w3.org/1999/xhtml" &&
    element.localName === "a" &&
    name === "href"
  );
}

export function safeHtmlAnchorHref(value) {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    /%(?:0[\da-f]|1[\da-f]|7f)/iu.test(value)
  )
    return false;
  try {
    return ["http:", "https:", "mailto:", "tel:"].includes(
      new URL(value, "https://capture.invalid/").protocol,
    );
  } catch {
    return false;
  }
}

export function installHtmlCaptureNavigationGuard(captureDocument) {
  for (const type of ["click", "auxclick", "submit"])
    captureDocument.addEventListener(type, (event) => event.preventDefault(), true);
}
