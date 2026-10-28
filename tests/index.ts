// Все автопроверки игры. Запуск: npm test
// Гоняют физику и бой без браузера; после изменений в src/shared/ — запускать обязательно.

import './movement';
import './combat';
import { finish } from './check';

finish();
