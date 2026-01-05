type InputSource = "sidebar" | "fullscreen" | null;

let activeSource: InputSource = null;

export function setActiveInputSource(source: InputSource): void {
  activeSource = source;
}

export function getActiveInputSource(): InputSource {
  return activeSource;
}

export function isInputSourceActive(source: InputSource): boolean {
  return activeSource === source;
}
