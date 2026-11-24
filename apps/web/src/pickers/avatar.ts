import { Avatar } from '../ui';

/** User avatar picture (users.avatarFile) or null — then Avatar draws the initials. */
export const avatarSrc = (u: { avatarFile?: string | null } | null | undefined): string | null =>
  u?.avatarFile ? `/files/${u.avatarFile}/preview?w=256` : null;

/**
 * Icon of a user row — the same in the user picker and in the @ hint (PLNRAPP-827): the picture
 * (`avatar` URL or avatarFile) or the initials.
 */
export const userIcon = (u: {
  name: string;
  avatar?: string | null;
  avatarFile?: string | null;
}) => ({
  icon: Avatar,
  iconProps: { name: u.name, src: u.avatar ?? avatarSrc(u), size: 'xs' as const },
});
