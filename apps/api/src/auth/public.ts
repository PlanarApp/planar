import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'planar:public';
/** Снимает глобальную проверку авторизации с обработчика или контроллера. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
