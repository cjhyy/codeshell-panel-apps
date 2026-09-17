/* Shared, dependency-free select menu for independently installed Panel Apps. */
(() => {
  if (globalThis.__panelSelectInstalled) return;
  globalThis.__panelSelectInstalled = true;

  const eligible = (select) =>
    select instanceof HTMLSelectElement &&
    !select.multiple &&
    select.size <= 1 &&
    !select.hasAttribute("data-native-select");

  let opened = null;
  let nextId = 0;
  let pointerSelect = null;
  let pointerAt = 0;

  function close() {
    if (!opened) return;
    const { select, menu, observer } = opened;
    observer.disconnect();
    menu.remove();
    select.removeAttribute("aria-expanded");
    select.removeAttribute("aria-controls");
    select.removeAttribute("aria-activedescendant");
    opened = null;
  }

  function position() {
    if (!opened) return;
    const { select, menu } = opened;
    const rect = select.getBoundingClientRect();
    if (!rect.width || !rect.height || !select.isConnected || select.disabled) {
      close();
      return;
    }
    const gap = 5;
    const edge = 8;
    const below = window.innerHeight - rect.bottom - edge - gap;
    const above = rect.top - edge - gap;
    const space = Math.max(below, above);
    menu.style.maxHeight = `${Math.max(96, Math.min(320, space))}px`;
    menu.style.minWidth = `${Math.min(rect.width, window.innerWidth - edge * 2)}px`;
    menu.style.maxWidth = `${Math.max(120, window.innerWidth - edge * 2)}px`;
    const width = menu.getBoundingClientRect().width;
    menu.style.left = `${Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge))}px`;
    menu.style.top =
      below >= Math.min(menu.scrollHeight, 320) || below >= above
        ? `${rect.bottom + gap}px`
        : `${Math.max(edge, rect.top - menu.getBoundingClientRect().height - gap)}px`;
  }

  function setActive(index, scroll = true) {
    if (!opened) return;
    const { select, menu } = opened;
    const rows = [...menu.querySelectorAll("[data-panel-select-index]")];
    const row = rows.find((item) => Number(item.dataset.panelSelectIndex) === index);
    if (!row || row.getAttribute("aria-disabled") === "true") return;
    opened.activeIndex = index;
    for (const item of rows) item.classList.toggle("is-active", item === row);
    select.setAttribute("aria-activedescendant", row.id);
    if (scroll) {
      const rowTop = row.offsetTop;
      if (rowTop < menu.scrollTop) menu.scrollTop = rowTop;
      else if (rowTop + row.offsetHeight > menu.scrollTop + menu.clientHeight) {
        menu.scrollTop = rowTop + row.offsetHeight - menu.clientHeight;
      }
    }
  }

  function render() {
    if (!opened) return;
    const { select, menu } = opened;
    menu.replaceChildren();
    const options = [...select.options];
    let previousGroup = null;
    options.forEach((option, index) => {
      const group = option.parentElement instanceof HTMLOptGroupElement ? option.parentElement : null;
      if (group !== previousGroup && group) {
        const heading = document.createElement("div");
        heading.className = "panel-select-group";
        heading.textContent = group.label;
        menu.append(heading);
      }
      previousGroup = group;
      const row = document.createElement("div");
      row.className = "panel-select-option";
      row.id = `${menu.id}-option-${index}`;
      row.setAttribute("role", "option");
      row.dataset.panelSelectIndex = String(index);
      row.setAttribute("aria-selected", String(index === select.selectedIndex));
      const disabled = option.disabled || Boolean(group?.disabled);
      if (disabled) row.setAttribute("aria-disabled", "true");
      const label = document.createElement("span");
      label.className = "panel-select-label";
      label.textContent = option.label || option.textContent || "";
      const check = document.createElement("span");
      check.className = "panel-select-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = index === select.selectedIndex ? "✓" : "";
      row.append(label, check);
      menu.append(row);
    });
    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = "panel-select-empty";
      empty.textContent = "暂无可选项";
      menu.append(empty);
    }
    position();
    const preferred = options[opened.activeIndex] && !options[opened.activeIndex].disabled
      ? opened.activeIndex
      : select.selectedIndex;
    const firstEnabled = options.findIndex((option) => !option.disabled && !option.parentElement?.disabled);
    setActive(preferred >= 0 ? preferred : firstEnabled);
  }

  function open(select) {
    if (opened?.select === select) return;
    close();
    if (!eligible(select) || select.disabled) return;
    const menu = document.createElement("div");
    menu.className = "panel-select-menu";
    menu.id = `panel-select-menu-${++nextId}`;
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", select.getAttribute("aria-label") || select.labels?.[0]?.textContent?.trim() || "选项");
    (select.closest("dialog[open]") || document.body).append(menu);
    const observer = new MutationObserver(() => render());
    opened = { select, menu, observer, activeIndex: select.selectedIndex, search: "", searchedAt: 0 };
    select.setAttribute("aria-expanded", "true");
    select.setAttribute("aria-controls", menu.id);
    observer.observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "label", "value", "selected"],
      characterData: true,
    });
    render();
  }

  function commit(index) {
    if (!opened) return;
    const { select } = opened;
    const option = select.options[index];
    if (!option || option.disabled || option.parentElement?.disabled) return;
    const changed = select.selectedIndex !== index;
    close();
    select.focus({ preventScroll: true });
    if (!changed) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  document.addEventListener("pointerdown", (event) => {
    const select = event.target instanceof HTMLSelectElement ? event.target : null;
    if (select && eligible(select) && !select.disabled && event.button === 0) {
      event.preventDefault();
      pointerSelect = select;
      pointerAt = event.timeStamp;
      select.focus({ preventScroll: true });
      if (opened?.select === select) close();
      else open(select);
      return;
    }
    const row = event.target instanceof Element ? event.target.closest("[data-panel-select-index]") : null;
    if (row && opened?.menu.contains(row)) {
      event.preventDefault();
      commit(Number(row.dataset.panelSelectIndex));
      return;
    }
    if (opened && !opened.menu.contains(event.target)) close();
  }, true);

  // A label forwards a click to its select without forwarding pointerdown.
  document.addEventListener("click", (event) => {
    const select = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!select || !eligible(select) || select.disabled) return;
    event.preventDefault();
    if (pointerSelect === select && event.timeStamp - pointerAt < 1000) {
      pointerSelect = null;
      return;
    }
    select.focus({ preventScroll: true });
    if (opened?.select === select) close();
    else open(select);
  }, true);

  document.addEventListener("keydown", (event) => {
    const select = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!select || !eligible(select) || select.disabled) return;
    if (event.key === "Tab") {
      close();
      return;
    }
    if (event.key === "Escape") {
      if (opened?.select === select) {
        event.preventDefault();
        close();
      }
      return;
    }
    const typing = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp", "Enter", " "].includes(event.key) && !typing) return;
    event.preventDefault();
    const wasOpen = opened?.select === select;
    if (!wasOpen) open(select);
    if (!opened) return;
    if (event.key === "Enter" || event.key === " ") {
      if (wasOpen) commit(opened.activeIndex);
      return;
    }
    const enabled = [...select.options].flatMap((option, index) =>
      option.disabled || option.parentElement?.disabled ? [] : [index],
    );
    if (!enabled.length) return;
    const current = Math.max(0, enabled.indexOf(opened.activeIndex));
    if (event.key === "Home") setActive(enabled[0]);
    else if (event.key === "End") setActive(enabled.at(-1));
    else if (event.key === "ArrowDown") setActive(enabled[Math.min(enabled.length - 1, current + 1)]);
    else if (event.key === "ArrowUp") setActive(enabled[Math.max(0, current - 1)]);
    else if (event.key === "PageDown") setActive(enabled[Math.min(enabled.length - 1, current + 8)]);
    else if (event.key === "PageUp") setActive(enabled[Math.max(0, current - 8)]);
    else if (typing) {
      const now = Date.now();
      opened.search = now - opened.searchedAt < 700 ? opened.search + event.key : event.key;
      opened.searchedAt = now;
      const match = enabled.find((index) =>
        select.options[index].textContent.trim().toLocaleLowerCase().startsWith(opened.search.toLocaleLowerCase()),
      );
      if (match !== undefined) setActive(match);
    }
  }, true);

  document.addEventListener("focusin", (event) => {
    if (opened && event.target !== opened.select && !opened.menu.contains(event.target)) close();
  });
  document.addEventListener("scroll", (event) => {
    if (opened && !opened.menu.contains(event.target)) close();
  }, true);
  window.addEventListener("resize", position);
})();
