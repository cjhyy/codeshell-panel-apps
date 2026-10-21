export const linkCases = [
  ["hash", "#", "#123456"],
  ["empty", "", "#123456"],
  ["named", "#section", "#123456"],
  ["relative", "relative/page.html?view=1#x", "#654321"],
  ["external", "https://link.invalid/page", "#123456"],
  ["scheme-relative", "//link.invalid/page", "#123456"],
  ["mail", "mailto:design@example.invalid", "#123456"],
  ["phone", "tel:+123456789", "#123456"],
  ["script", "javascript:alert(1)", "#777777"],
  ["control", "java&#9;script:alert(1)", "#777777"],
  ["encoded-control", "https://link.invalid/%0a", "#777777"],
  ["data", "data:image/png;base64,YQ==", "#777777"],
  ["none", null, "#777777"],
];

export const linkCaptureHtml = `<style>body{margin:0;font:16px Arial;color:#777777}main{display:flex;flex-direction:column;width:480px}a{display:block;height:20px;flex:none}a:link{color:#123456}a[href="relative/page.html?view=1#x"]{color:#654321}</style><main>${linkCases.map(([id, href]) => `<a id="${id}"${href === null ? "" : ` href="${href}"`}>${id} link</a>`).join("")}<form action="https://link.invalid/submit"><button>Submit</button></form></main>`;

export function inspectCapturedLinks(main) {
  const doc = main.ownerDocument;
  const probe = (target, type) => {
    const event = new doc.defaultView.Event(type, { bubbles: true, cancelable: true });
    return { dispatched: target.dispatchEvent(event), prevented: event.defaultPrevented };
  };
  return {
    links: [...main.querySelectorAll("a")].map((link) => ({
      id: link.id,
      href: link.getAttribute("href"),
      color: doc.defaultView.getComputedStyle(link).color,
    })),
    click: probe(main.querySelector("#external"), "click"),
    auxclick: probe(main.querySelector("#external"), "auxclick"),
    submit: probe(main.querySelector("form"), "submit"),
    action: main.querySelector("form").getAttribute("action"),
    scripts: doc.querySelectorAll("script").length,
  };
}
