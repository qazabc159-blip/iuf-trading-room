export const workspaceRoles = ["Owner", "Admin", "Analyst", "Trader", "Viewer"] as const;

export type WorkspaceRole = (typeof workspaceRoles)[number];

export const canEditResearch = (role: WorkspaceRole) =>
  role === "Owner" || role === "Admin" || role === "Analyst";

export const canEditExecution = (role: WorkspaceRole) =>
  role === "Owner" || role === "Admin" || role === "Trader";
