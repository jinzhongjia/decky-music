import { Navigation } from "@decky/ui";

export const ROUTE_PATH = "/decky-music";

const MENU_ENTRY_ATTR = "data-decky-music-menu-entry";
const INSTALL_INTERVAL_MS = 1000;

type DeckyRuntimeGlobal = typeof globalThis & {
  DFL?: {
    getGamepadNavigationTrees?: () => Array<{
      m_ID?: string;
      Root?: {
        Element?: HTMLElement;
      };
    }>;
  };
};

let isPatched = false;
let intervalTimerId: ReturnType<typeof setInterval> | null = null;

const findMainMenuElement = (): HTMLElement | null => {
  try {
    const menuFromNavTree = (
      globalThis as DeckyRuntimeGlobal
    ).DFL?.getGamepadNavigationTrees?.().find((tree) => tree?.m_ID === "MainNavMenuContainer")?.Root
      ?.Element;

    if (menuFromNavTree) {
      return menuFromNavTree;
    }
  } catch {
    // Fall back to the DOM lookup below.
  }

  return document.getElementById("MainNavMenuContainer");
};

const navigateToMusic = (event?: Event) => {
  event?.preventDefault();
  event?.stopPropagation();

  try {
    Navigation.Navigate(ROUTE_PATH);
  } catch {
    // Steam may rebuild the menu while the click is being handled.
  }
};

const replaceIcon = (menuItem: Element) => {
  const oldIcon = menuItem.querySelector("svg");
  if (!oldIcon) {
    return;
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 512 512");
  svg.setAttribute("fill", "none");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute(
    "d",
    "M470.38 1.51L150.41 96A32 32 0 0 0 128 126.51v261.41A139 139 0 0 0 96 384c-53 0-96 28.66-96 64s43 64 96 64 96-28.66 96-64V214.32l256-75v184.61a138.4 138.4 0 0 0-32-3.93c-53 0-96 28.66-96 64s43 64 96 64 96-28.65 96-64V32a32 32 0 0 0-41.62-30.49z"
  );

  svg.appendChild(path);
  oldIcon.replaceWith(svg);
};

const stripFocusState = (entry: Element) => {
  entry.querySelectorAll("*").forEach((element) => {
    element.classList.remove("gpfocus", "gpfocuswithin");
  });
};

const findMenuItemByLabels = (menuItems: Element[], labels: string[]) =>
  menuItems.find((item) => {
    const ariaLabel = item.getAttribute("aria-label")?.trim().toLocaleLowerCase();
    return ariaLabel ? labels.includes(ariaLabel) : false;
  }) || null;

const findLeafTextElement = (menuItem: Element, originalLabel: string | null) => {
  const candidates = Array.from(menuItem.querySelectorAll("div")).reverse();

  if (originalLabel) {
    const exactMatch = candidates.find((element) => element.textContent?.trim() === originalLabel);
    if (exactMatch) {
      return exactMatch;
    }
  }

  return (
    candidates.find(
      (element) =>
        element.children.length === 0 &&
        Boolean(element.textContent?.trim()) &&
        !element.querySelector("svg")
    ) || null
  );
};

const setEntryLabel = (menuItem: Element, originalLabel: string | null) => {
  menuItem.setAttribute("aria-label", "\u97f3\u4e50");
  menuItem.setAttribute("tabindex", "0");
  menuItem.removeAttribute("data-gp-focus");
  menuItem.removeAttribute("data-gp-focus-visible");

  const labelElement = findLeafTextElement(menuItem, originalLabel);
  if (labelElement) {
    labelElement.textContent = "\u97f3\u4e50";
  }
};

const bindNavigation = (menuItem: Element) => {
  menuItem.addEventListener("click", navigateToMusic, true);
  menuItem.addEventListener("mouseup", navigateToMusic, true);
  menuItem.addEventListener(
    "keydown",
    (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        navigateToMusic(event);
      }
    },
    true
  );
};

const installMenuEntryOnce = () => {
  const mainMenu = findMainMenuElement();
  if (!mainMenu || mainMenu.querySelector(`[${MENU_ENTRY_ATTR}]`)) {
    return;
  }

  const menuItems = Array.from(mainMenu.querySelectorAll('[role="menuitem"]'));
  const settingsItem =
    findMenuItemByLabels(menuItems, ["settings", "\u8bbe\u7f6e"]) ||
    menuItems[menuItems.length - 2] ||
    null;
  const settingsRow = settingsItem?.parentElement;
  if (!settingsItem || !settingsRow?.parentElement) {
    return;
  }

  const mediaItem =
    findMenuItemByLabels(menuItems, ["media", "\u5a92\u4f53"]) || menuItems[4] || null;
  const insertBeforeRow = mediaItem?.parentElement || settingsRow;
  const originalLabel = settingsItem.getAttribute("aria-label")?.trim() || null;

  const entry = settingsRow.cloneNode(true) as Element;
  entry.setAttribute(MENU_ENTRY_ATTR, "true");
  stripFocusState(entry);

  const menuItem = entry.querySelector('[role="menuitem"]') || entry;
  setEntryLabel(menuItem, originalLabel);
  replaceIcon(menuItem);
  bindNavigation(menuItem);

  insertBeforeRow.parentElement?.insertBefore(entry, insertBeforeRow);
};

export const menuManager = {
  tryEnable: () => {
    if (isPatched) {
      return;
    }

    installMenuEntryOnce();
    intervalTimerId = setInterval(installMenuEntryOnce, INSTALL_INTERVAL_MS);
    isPatched = true;
  },

  enable: () => {
    menuManager.tryEnable();
  },

  disable: () => {
    if (intervalTimerId) {
      clearInterval(intervalTimerId);
      intervalTimerId = null;
    }

    findMainMenuElement()
      ?.querySelectorAll(`[${MENU_ENTRY_ATTR}]`)
      .forEach((entry) => entry.remove());

    isPatched = false;
  },

  cleanup: () => {
    menuManager.disable();
  },

  isEnabled: () => isPatched,
};

export const patchMenu = () => {
  menuManager.enable();
  return () => menuManager.cleanup();
};
