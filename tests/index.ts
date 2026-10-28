// Все автопроверки игры. Запуск: npm test
// Гоняют физику, бой и сеть без браузера; после изменений в src/shared/ — запускать обязательно.

import './movement';
import './parkour';
import './combat';
import './net';
import { finish } from './check';

finish();
