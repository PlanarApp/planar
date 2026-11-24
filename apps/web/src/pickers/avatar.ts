/** User avatar picture (users.avatarFile) or null — then Avatar draws the initials. */
export const avatarSrc = (u: { avatarFile?: string | null } | null | undefined): string | null =>
  u?.avatarFile ? `/files/${u.avatarFile}/preview?w=256` : null;
