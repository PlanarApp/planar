// shortcut: относительный путь вместо '@planar/shared' — контрактный тест идёт в node-окружении,
// где условие экспорта `source` не подхватывается (vitest.config вне scope WB-2); вернуть, когда координатор поправит конфиг.
export * from '../../../../packages/shared/src/index';
