import type { Player } from './world';

// Манекены для тренировки. Пока не стреляют — стоят, бегают туда-сюда или распрыгивают.
// Они двигаются тем же кодом, что и игрок, поэтому их тоже швыряет взрывами.

/**
 * idle   — стоит на месте;
 * strafe — бегает влево-вправо (учись брать упреждение);
 * bhop   — распрыгивает по кругу (учись попадать в летящего).
 */
export type BotBehavior = 'idle' | 'strafe' | 'bhop';

/** Заполнить команду манекена на этот тик. time — время мира в секундах. */
export function updateBotCmd(p: Player, time: number): void {
  const cmd = p.cmd;
  cmd.forward = 0;
  cmd.right = 0;
  cmd.jump = false;
  cmd.fire = false;

  switch (p.bot) {
    case 'strafe':
      // Меняет направление примерно раз в 1.4 секунды (+ id, чтобы манекены не бегали синхронно)
      cmd.right = Math.sin(time * 2.2 + p.id) > 0 ? 1 : -1;
      break;
    case 'bhop':
      cmd.forward = 1;
      cmd.jump = true;
      cmd.yaw = p.spawn.yaw + time * 1.1; // плавно поворачивает — получается круг
      break;
  }
}
