import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'planar:public';
/** Removes the global auth check from a handler or controller. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
