export const workspaceRoles = ["Owner", "Admin", "Analyst", "Trader", "Viewer"] as const;

export type WorkspaceRole = (typeof workspaceRoles)[number];
