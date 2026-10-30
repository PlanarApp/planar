import argon2 from 'argon2';

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });

export const verifyPassword = (hash: string, pw: string) =>
  argon2.verify(hash, pw).catch(() => false);

let dummy: Promise<string> | undefined;
/** For an unknown login: the same work as for a known one (constant time). */
export const verifyDummy = async (pw: string) => {
  dummy ??= hashPassword('planar-dummy');
  await verifyPassword(await dummy, pw);
};
