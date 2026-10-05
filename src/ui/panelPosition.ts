// Where the floating matching panel opens: where the operator last dropped
// it, unless that spot now covers the sidebar or leaves the window — then
// right next to the sidebar, over the map.

const GAP = 16;
const TOP = 72;

export function initialPanelPosition(input: {
  stored: { left: number; top: number } | null;
  sidebarRight: number;
  viewport: { width: number; height: number };
  panel: { width: number; height: number };
}): { left: number; top: number } {
  const fallback = { left: input.sidebarRight + GAP, top: TOP };
  const { stored, viewport, panel } = input;
  if (!stored) return fallback;
  const coversSidebar = stored.left < input.sidebarRight;
  const offScreen =
    stored.left + panel.width > viewport.width || stored.top + panel.height > viewport.height;
  return coversSidebar || offScreen ? fallback : stored;
}
