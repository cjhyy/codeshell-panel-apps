// Report-only capture evidence. Nothing in this module admits saved documents or
// changes layout: actual DOM identities are discarded after binding stable IDs.
const MAX_NODES = 10_000;
const MAX_DEPTH = 32;
const MAX_DETAILS = 500;
const ORIGINAL = Symbol("current-capture-node");
const tableProofs = new WeakSet();
const TABLE_KINDS = [
  "fixed-table-row",
  "fixed-table-cell",
  "fixed-table-content",
  "fixed-table-text",
];
const AUTO = new Set(["horizontal", "vertical", "grid"]);
const FLEX_GRID = new Set(["flex", "inline-flex", "grid", "inline-grid"]);
const BLOCK = new Set(["block", "flow-root", "inline-block"]);
const BLOCK_CHILD = new Set(["block", "flow-root", "flex", "grid", "table", "list-item"]);
const REPLACED = new Set(
  "img svg canvas input textarea select option button iframe object embed video audio meter progress".split(
    " ",
  ),
);
const zeroOffset = (value) => value === "auto" || /^-?0(?:\.0+)?(?:px)?$/u.test(value);
const htmlElement = (element) =>
  element?.nodeType === 1 &&
  (element.namespaceURI === "http://www.w3.org/1999/xhtml" ||
    (element.namespaceURI === "http://www.w3.org/2000/svg" && element.localName === "svg"));
const plain = (value) => value && typeof value === "object" && !Array.isArray(value);
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
function nodeIndex(document) {
  const index = new Map();
  const add = (node, parentId = node?.parentId) => {
    if (
      !plain(node) ||
      typeof node.id !== "string" ||
      !node.id ||
      node.id.length > 300 ||
      index.has(node.id) ||
      index.size >= MAX_NODES
    )
      throw new Error("Flow audit contains missing/duplicate or excessive canonical IDs");
    index.set(node.id, { ...node, parentId, [ORIGINAL]: node });
  };
  if (Array.isArray(document?.nodes)) for (const node of document.nodes) add(node);
  else if (Array.isArray(document?.pages)) {
    const visit = (node, parentId, depth) => {
      if (depth > MAX_DEPTH) throw new Error("Flow audit contains deep canonical ancestry");
      if (Object.hasOwn(node, "parentId") && node.parentId !== parentId)
        throw new Error("Flow audit contains conflicting canonical parent identity");
      add(node, parentId);
      for (const child of node.children ?? []) visit(child, node.id, depth + 1);
    };
    for (const page of document.pages)
      for (const node of page.children ?? []) visit(node, undefined, 0);
  } else throw new Error("Flow audit requires a bounded canonical document");
  for (const node of index.values()) {
    if (node.parentId && !index.has(node.parentId))
      throw new Error("Flow audit contains orphan canonical nodes");
    const seen = new Set();
    let current = node;
    for (let depth = 0; current; depth++) {
      if (seen.has(current.id) || depth > MAX_DEPTH)
        throw new Error("Flow audit contains cyclic/deep canonical ancestry");
      seen.add(current.id);
      current = index.get(current.parentId);
    }
  }
  return index;
}
function ancestor(index, child, parent) {
  let current = child;
  const seen = new Set();
  for (let depth = 0; current && depth <= MAX_DEPTH; depth++) {
    if (current === parent) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = index.get(current)?.parentId;
  }
  return false;
}
function outermost(index, ids) {
  const candidates = [...new Set(ids)].filter((id) => index.has(id));
  if (candidates.length > 64) return null;
  const roots = candidates.filter((id) => candidates.every((other) => ancestor(index, other, id)));
  return roots.length === 1 ? roots[0] : null;
}
function generated(view, element) {
  return ["::before", "::after"].some(
    (pseudo) => !["none", "normal"].includes(view.getComputedStyle(element, pseudo).content),
  );
}
function ordinary(style, owner = false) {
  return (
    (owner ? ["static", "relative", "absolute", "fixed"] : ["static", "relative"]).includes(
      style.position,
    ) &&
    style.cssFloat === "none" &&
    style.transform === "none" &&
    ["rotate", "scale", "translate", "perspective"].every(
      (key) => !style[key] || style[key] === "none",
    ) &&
    ["", "1", "normal"].includes(style.zoom ?? "") &&
    ["auto", "1"].includes(style.columnCount) &&
    style.columnWidth === "auto" &&
    style.writingMode === "horizontal-tb" &&
    style.direction === "ltr" &&
    (owner ||
      style.position !== "relative" ||
      ["top", "right", "bottom", "left"].every((key) => zeroOffset(style[key])))
  );
}

function validateTableProof(
  proof,
  { root, elements, document, ambiguousElements = new WeakSet() },
  committed,
) {
  const index = nodeIndex(document),
    bound = new Set(elements.values());
  const element = (value) =>
    htmlElement(value) &&
    value.ownerDocument === root.ownerDocument &&
    root.contains(value) &&
    bound.has(value) &&
    !ambiguousElements.has(value);
  const node = (value) => value && index.get(value.id)?.[ORIGINAL] === value;
  if (
    !plain(proof) ||
    !element(proof.tableElement) ||
    !node(proof.tableNode) ||
    !Array.isArray(proof.relations) ||
    !proof.relations.length ||
    proof.relations.length > MAX_NODES ||
    (committed && proof.tableNode.layout !== "vertical")
  )
    throw new Error("Fixed-table flow proof lacks current Element/original node ownership");
  const seen = new Set();
  for (const relation of proof.relations) {
    const { parentElement, childElement, parentNode, childNode, kind } = relation;
    if (
      !TABLE_KINDS.includes(kind) ||
      !element(parentElement) ||
      !element(childElement) ||
      !proof.tableElement.contains(parentElement) ||
      !proof.tableElement.contains(childElement) ||
      !node(parentNode) ||
      !node(childNode) ||
      parentNode === childNode ||
      !ancestor(index, parentNode.id, proof.tableNode.id) ||
      !ancestor(index, childNode.id, parentNode.id)
    )
      throw new Error(
        "Fixed-table flow proof has detached or unrelated source/canonical identities",
      );
    const key = `${parentNode.id}:${childNode.id}`;
    if (seen.has(key)) throw new Error("Fixed-table flow proof repeats a relationship");
    seen.add(key);
    if (kind === "fixed-table-text") {
      if (
        parentElement !== childElement ||
        childNode.type !== "text" ||
        index.get(childNode.id).parentId !== parentNode.id ||
        !Array.isArray(relation.lineBreaks) ||
        relation.lineBreaks.length > 4000 ||
        relation.lineBreaks.length !== parentElement.children.length ||
        relation.lineBreaks.some(
          (br, i) =>
            br !== parentElement.children[i] ||
            br.localName !== "br" ||
            br.parentElement !== parentElement ||
            br.childNodes.length,
        )
      )
        throw new Error("Fixed-table own Text/BR proof does not match its exact current owner");
    } else if (
      childElement.parentElement !== parentElement ||
      parentElement === childElement ||
      Object.hasOwn(relation, "lineBreaks")
    )
      throw new Error("Fixed-table source relationship is not an exact direct Element edge");
    if (
      committed &&
      (parentNode.layout !== (kind === "fixed-table-cell" ? "grid" : "vertical") ||
        (kind !== "fixed-table-text" &&
          childNode.layout !== (kind === "fixed-table-row" ? "grid" : "vertical")))
    )
      throw new Error("Fixed-table flow proof was not published after its complete layout commit");
  }
}

/** Prepare only current live references before the promoter commits any draft. */
export function prepareHtmlFixedTableFlowAudit(context, proof) {
  validateTableProof(proof, context, false);
  const prepared = Object.freeze({
    tableElement: proof.tableElement,
    tableNode: proof.tableNode,
    relations: Object.freeze(
      proof.relations.map((relation) =>
        Object.freeze({
          ...relation,
          ...(relation.lineBreaks ? { lineBreaks: Object.freeze([...relation.lineBreaks]) } : {}),
        }),
      ),
    ),
  });
  tableProofs.add(prepared);
  return prepared;
}

/** Called only before the capture iframe closes; never binds by CSS selectors. */
export function captureHtmlFlowObligations({
  root,
  elements,
  mapping,
  document,
  ambiguousElements = new WeakSet(),
  syntheticIds = new Set(),
  recoveredTables = [],
}) {
  const view = root?.ownerDocument?.defaultView;
  if (
    !view ||
    !(elements instanceof Map) ||
    !Array.isArray(mapping) ||
    mapping.length > MAX_NODES ||
    !Array.isArray(recoveredTables) ||
    recoveredTables.length > 32
  )
    throw new Error("Flow audit requires the current capture's DOM bindings");
  const index = nodeIndex(document),
    records = new Map(),
    byElement = new Map();
  const canonicalChildren = new Map();
  for (const node of index.values()) {
    if (!canonicalChildren.has(node.parentId)) canonicalChildren.set(node.parentId, []);
    canonicalChildren.get(node.parentId).push(node);
  }
  // Only IDs reported by a trusted current producer factory are wrapper proof.
  // A missing mapping or candidate name/notes never admits an intermediate frame.
  const semanticSourceIds = new Set(
    mapping
      .filter((entry) => typeof entry.semanticId === "string" && entry.semanticId)
      .map((entry) => entry.designId),
  );
  const wrappers = new Set([...syntheticIds].filter((id) => !semanticSourceIds.has(id)));
  const ledger = {
    format: "codeshell.html.flow-obligations",
    version: 1,
    obligations: [],
    bindings: [],
    source: {
      elements: 0,
      proven: 0,
      excluded: 0,
      ambiguous: 0,
      unsupported: 0,
      unmapped: 0,
      details: [],
      omittedDetails: 0,
    },
  };
  const record = (element) => {
    if (!records.has(element)) {
      if (records.size >= MAX_NODES) throw new Error("Flow audit exceeds 10,000 source elements");
      records.set(element, { sourceId: `element-${records.size}`, semanticIds: [], designIds: [] });
    }
    return records.get(element);
  };
  const detail = (category, reason, parent, child = parent) => {
    ledger.source[category]++;
    const value = {
      category,
      reason,
      parentSourceId: record(parent).sourceId,
      childSourceId: record(child).sourceId,
    };
    if (ledger.source.details.length < MAX_DETAILS) ledger.source.details.push(value);
    else ledger.source.omittedDetails++;
  };
  const tableRelations = new Map(),
    tableTexts = new Map();
  for (const proof of recoveredTables) {
    try {
      if (!tableProofs.has(proof)) throw new Error("Unprepared fixed-table proof");
      validateTableProof(proof, { root, elements, document, ambiguousElements }, true);
      for (const relation of proof.relations) {
        if (relation.kind === "fixed-table-text") tableTexts.set(relation.parentElement, relation);
        else {
          if (!tableRelations.has(relation.parentElement))
            tableRelations.set(relation.parentElement, new Map());
          tableRelations.get(relation.parentElement).set(relation.childElement, relation);
        }
      }
    } catch {
      detail("unsupported", "fixed-table-proof-unverified", root);
    }
  }
  // A semantic ID may be referenced by container and Text for the same Element.
  // Only a collision between different actual Elements makes it ambiguous.
  for (const [semanticId, element] of elements) {
    if (
      !htmlElement(element) ||
      element.ownerDocument !== root.ownerDocument ||
      !root.contains(element)
    )
      continue;
    const entry = record(element);
    entry.semanticIds.push(String(semanticId).slice(0, 300));
    byElement.set(element, entry);
  }
  for (const value of mapping) {
    const element = elements.get(value.semanticId),
      entry = byElement.get(element);
    if (entry && index.has(value.designId)) entry.designIds.push(value.designId);
  }
  const resolve = (element) => {
    if (ambiguousElements.has(element))
      return { category: "ambiguous", reason: "semantic-id-collision" };
    const entry = byElement.get(element);
    if (!entry?.designIds.length)
      return { category: "unmapped", reason: "missing-current-element-binding" };
    const id = outermost(index, entry.designIds);
    return id
      ? { id }
      : { category: "ambiguous", reason: "disconnected-canonical-representations" };
  };
  const styles = new Map();
  const styleOf = (element) => {
    if (!styles.has(element)) styles.set(element, view.getComputedStyle(element));
    return styles.get(element);
  };
  const visibleBox = (element) => {
    const style = styleOf(element),
      box = element.getBoundingClientRect();
    return (
      style.display !== "none" && style.visibility === "visible" && box.width > 0 && box.height > 0
    );
  };
  const obligation = (parent, child, kind, childId = null, exact = null) => {
    const owner = resolve(parent),
      target = childId ? { id: childId } : resolve(child);
    for (const proof of [owner, target])
      if (!proof.id) {
        detail(proof.category, proof.reason, parent, child);
        return;
      }
    if (exact && (owner.id !== exact.parentNode.id || target.id !== exact.childNode.id)) {
      detail("ambiguous", "fixed-table-canonical-binding-mismatch", parent, child);
      return;
    }
    if (ledger.obligations.length >= MAX_NODES)
      throw new Error("Flow audit exceeds 10,000 obligations");
    if (parent !== child && owner.id === target.id) {
      detail("ambiguous", "shared-canonical-representation", parent, child);
      return;
    }
    const wrapperIds = [],
      seen = new Set();
    let current = index.get(target.id);
    while (current && current.id !== owner.id && !seen.has(current.id)) {
      seen.add(current.id);
      current = index.get(current.parentId);
      if (current && current.id !== owner.id && wrappers.has(current.id))
        wrapperIds.push(current.id);
    }
    ledger.obligations.push({
      wrapperIds,
      id: `flow-${ledger.obligations.length}`,
      kind,
      parentId: owner.id,
      childId: target.id,
      parentSourceId: record(parent).sourceId,
      childSourceId: record(child).sourceId,
    });
    ledger.source.proven++;
  };
  const visit = (parent, depth) => {
    if (depth > MAX_DEPTH) throw new Error("Flow audit exceeds 32 DOM levels");
    if (!htmlElement(parent)) return;
    record(parent);
    const parentStyle = styleOf(parent);
    if (parentStyle.display === "none") {
      detail("excluded", "display-none-subtree", parent);
      return;
    }
    if (!visibleBox(parent)) detail("unsupported", "zero-contents-or-invisible-owner-box", parent);
    if (generated(view, parent)) detail("unsupported", "generated-content-flow", parent);
    if (REPLACED.has(parent.localName)) {
      detail("excluded", "replaced-leaf-internals", parent);
      return;
    }
    const textProof = tableTexts.get(parent);
    const children = [...parent.children].filter(htmlElement).filter((child) => {
      if (!textProof?.lineBreaks.includes(child)) return true;
      detail("excluded", "fixed-table-line-break-token", parent, child);
      return false;
    });
    for (const child of children) {
      record(child);
      const style = styleOf(child);
      if (["absolute", "fixed"].includes(style.position))
        detail("excluded", "authored-out-of-flow", parent, child);
      else if (style.display === "none") detail("excluded", "display-none-child", parent, child);
      else if (!visibleBox(child) || !visibleBox(parent))
        detail("unsupported", "zero-contents-or-invisible-flow-box", parent, child);
      else if (!ordinary(parentStyle, true) || !ordinary(style) || generated(view, parent))
        detail(
          "unsupported",
          "special-position-transform-writing-or-generated-flow",
          parent,
          child,
        );
      else if (tableRelations.get(parent)?.has(child)) {
        const proof = tableRelations.get(parent).get(child);
        obligation(parent, child, proof.kind, null, proof);
      } else if (FLEX_GRID.has(parentStyle.display)) obligation(parent, child, "flex-grid-item");
      else if (BLOCK.has(parentStyle.display) && BLOCK_CHILD.has(style.display))
        obligation(parent, child, "block-item");
      else detail("unsupported", "table-inline-contents-or-other-box-flow", parent, child);
      visit(child, depth + 1);
    }
    if (
      children.length &&
      [...parent.childNodes].some(
        (node) => node.nodeType === 3 && /[^\t\n\f\r ]/u.test(node.textContent ?? ""),
      )
    )
      detail("unsupported", "mixed-anonymous-text-flow", parent);
    // A leaf need not own Auto Layout. A captured Frame with one real plain Text
    // has an internal flow relationship, unlike a direct canonical Text leaf.
    if (!children.length && /[^\t\n\f\r ]/u.test(parent.textContent ?? "")) {
      const owner = resolve(parent);
      if (!owner.id) {
        detail(owner.category, owner.reason, parent);
        return;
      }
      const node = index.get(owner.id);
      if (node.type === "text") return;
      if (textProof) obligation(parent, parent, textProof.kind, textProof.childNode.id, textProof);
      else if (
        ordinary(parentStyle, true) &&
        BLOCK.has(parentStyle.display) &&
        !generated(view, parent) &&
        ["", "0px"].includes(parentStyle.textIndent ?? "") &&
        ["::first-line", "::first-letter"].every((pseudo) => {
          const variant = view.getComputedStyle(parent, pseudo);
          return [
            "fontFamily",
            "fontSize",
            "fontWeight",
            "fontStyle",
            "lineHeight",
            "letterSpacing",
            "wordSpacing",
            "textTransform",
          ].every((key) => variant[key] === parentStyle[key]);
        })
      ) {
        const texts = [],
          stack = [...(canonicalChildren.get(owner.id) ?? [])];
        const seen = new Set();
        while (stack.length && texts.length < 2) {
          const child = stack.pop();
          if (seen.has(child.id)) break;
          seen.add(child.id);
          if (child.type === "text") texts.push(child);
          else stack.push(...(canonicalChildren.get(child.id) ?? []));
        }
        if (texts.length === 1) obligation(parent, parent, "plain-own-text", texts[0].id);
        else detail("unsupported", "multiple-or-missing-own-text-representations", parent);
      } else detail("unsupported", "special-own-text-box-flow", parent);
    }
  };
  visit(root, 0);
  ledger.source.elements = records.size;
  for (const [element, entry] of byElement) {
    const style = styleOf(element);
    for (const designId of new Set(entry.designIds))
      ledger.bindings.push({
        designId,
        sourceId: entry.sourceId,
        semanticIds: [...new Set(entry.semanticIds)],
        display: style.display,
        position: style.position,
        float: style.cssFloat,
      });
  }
  return freeze(ledger);
}

/** Validate and freeze a report crossing a browser structured-clone boundary. */
export function freezeHtmlFlowObligations(value) {
  if (
    !plain(value) ||
    value.format !== "codeshell.html.flow-obligations" ||
    value.version !== 1 ||
    !Array.isArray(value.obligations) ||
    value.obligations.length > MAX_NODES ||
    !Array.isArray(value.bindings) ||
    value.bindings.length > MAX_NODES ||
    !plain(value.source)
  )
    throw new Error("Missing or invalid capture-local flow obligations");
  const ids = new Set();
  for (const entry of value.obligations) {
    if (
      !plain(entry) ||
      Object.keys(entry).some(
        (key) =>
          ![
            "id",
            "kind",
            "parentId",
            "childId",
            "parentSourceId",
            "childSourceId",
            "wrapperIds",
          ].includes(key),
      ) ||
      !["block-item", "flex-grid-item", "plain-own-text", ...TABLE_KINDS].includes(entry.kind) ||
      typeof entry.id !== "string" ||
      entry.id.length > 300 ||
      ids.has(entry.id) ||
      !["parentId", "childId", "parentSourceId", "childSourceId"].every(
        (key) =>
          typeof entry[key] === "string" && entry[key].length > 0 && entry[key].length <= 300,
      )
    )
      throw new Error("Invalid or duplicate flow obligation");
    if (
      !Array.isArray(entry.wrapperIds) ||
      entry.wrapperIds.length > MAX_DEPTH ||
      !entry.wrapperIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 300)
    )
      throw new Error("Invalid captured wrapper proof");
    ids.add(entry.id);
  }
  for (const key of [
    "elements",
    "proven",
    "excluded",
    "ambiguous",
    "unsupported",
    "unmapped",
    "omittedDetails",
  ])
    if (
      !Number.isInteger(value.source[key]) ||
      value.source[key] < 0 ||
      value.source[key] > MAX_NODES * 4
    )
      throw new Error("Invalid flow source counts");
  if (
    value.source.proven !== value.obligations.length ||
    !Array.isArray(value.source.details) ||
    value.source.details.length > MAX_DETAILS
  )
    throw new Error("Inconsistent flow source evidence");
  for (const entry of value.bindings) {
    if (
      !plain(entry) ||
      Object.keys(entry).some(
        (key) =>
          !["designId", "sourceId", "semanticIds", "display", "position", "float"].includes(key),
      ) ||
      !["designId", "sourceId", "display", "position", "float"].every(
        (key) => typeof entry[key] === "string" && entry[key].length <= 300,
      ) ||
      !Array.isArray(entry.semanticIds) ||
      entry.semanticIds.length > 64 ||
      !entry.semanticIds.every((id) => typeof id === "string" && id.length <= 300)
    )
      throw new Error("Invalid flow source binding");
  }
  for (const entry of value.source.details) {
    if (
      !plain(entry) ||
      Object.values(entry).some((part) => typeof part !== "string" || part.length > 300)
    )
      throw new Error("Invalid flow source detail");
  }
  if (
    Object.keys(value).some(
      (key) => !["format", "version", "obligations", "bindings", "source"].includes(key),
    ) ||
    Object.keys(value.source).some(
      (key) =>
        ![
          "elements",
          "proven",
          "excluded",
          "ambiguous",
          "unsupported",
          "unmapped",
          "details",
          "omittedDetails",
        ].includes(key),
    )
  )
    throw new Error("Unknown flow evidence fields");
  return freeze(value);
}

/** Reevaluate current ancestry; a previous PASS never admits a changed candidate. */
export function evaluateHtmlFlowAudit(document, obligations) {
  freezeHtmlFlowObligations(obligations);
  const index = nodeIndex(document),
    issues = [],
    paths = [];
  let covered = 0,
    failures = 0;
  for (const expected of obligations.obligations) {
    let child = index.get(expected.childId),
      issue = null;
    const path = [],
      seen = new Set();
    if (!child || !index.has(expected.parentId)) issue = "FLOW_SOURCE_NODE_MISSING";
    if (!issue) {
      for (let current = child; current; current = index.get(current.parentId)) {
        if (current.visible === false) {
          issue = "FLOW_SOURCE_PARTICIPATION_LOST";
          path.push({ hiddenId: current.id });
          break;
        }
      }
    }
    while (!issue && child.id !== expected.parentId) {
      if (seen.has(child.id) || path.length > MAX_DEPTH) {
        issue = "FLOW_SOURCE_ANCESTRY_INVALID";
        break;
      }
      seen.add(child.id);
      const parent = index.get(child.parentId);
      if (!parent) {
        issue = "FLOW_SOURCE_ANCESTRY_LOST";
        break;
      }
      path.push({
        childId: child.id,
        parentId: parent.id,
        parentLayout: parent.layout ?? "none",
        childPositioning: child.layoutPositioning ?? "auto",
      });
      if (parent.id !== expected.parentId && !expected.wrapperIds.includes(parent.id))
        issue = "FLOW_SOURCE_PARENT_CHANGED";
      else if (child.layoutPositioning === "absolute") issue = "FLOW_BECAME_ABSOLUTE";
      else if (!AUTO.has(parent.layout)) issue = "NESTED_MANUAL_FLOW";
      child = parent;
    }
    if (issue) {
      failures++;
      if (issues.length < MAX_DETAILS) issues.push({ ...expected, code: issue, path });
    } else {
      covered++;
      if (paths.length < MAX_DETAILS) paths.push({ obligationId: expected.id, path });
    }
  }
  const unresolved =
    obligations.source.ambiguous + obligations.source.unsupported + obligations.source.unmapped;
  return {
    status: failures ? "FAIL" : unresolved ? "PARTIAL" : "PASS",
    passed: failures === 0 && unresolved === 0,
    obligations: obligations.obligations.length,
    covered,
    failures,
    unresolved,
    source: obligations.source,
    issues,
    omittedIssues: failures - issues.length,
    paths,
    omittedCoveredPaths: covered - paths.length,
  };
}
