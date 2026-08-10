// Deterministic color per pipeline stage name, so the same stage always gets
// the same accent color across the Kanban board, Overview funnel, and the
// Pipelines settings page, without needing a color column in the DB — any
// custom stage a user creates gets a consistent color automatically.
const PALETTE = [
  "#5C1A2E", // primary maroon
  "#2C5F7C", // steel blue
  "#3C7A5B", // forest green
  "#B8863B", // ochre
  "#6B4E8E", // plum
  "#C05B4C", // terracotta
  "#3A8C8C", // teal
  "#8C5C3A", // brown
];

export function stageColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
