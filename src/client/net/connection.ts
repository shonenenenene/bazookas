import type { Message } from '../../shared/net/binary';
import type { NetLink } from './online';

// Соединение с сервером через WebSocket.
// lagMs > 0 — искусственный пинг: сообщения в обе стороны задерживаются, будто сервер далеко.
// Так сетевой код можно проверить на своём компьютере (адрес с ?lag=150 или CLIENT.fakeLag).

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export class Connection implements NetLink {
  readonly inbox: ArrayBuffer[] = [];
  status: ConnectionStatus = 'connecting';
  /** Почему закрыли (текст от сервера, например «room is full») и код (CLOSE в protocol.ts) */
  closeReason = '';
  closeCode = 0;
  /** Вызывается при каждой смене статуса */
  onStatus: (status: ConnectionStatus) => void = () => {};

  private socket: WebSocket;
  private halfLag: number;

  constructor(url: string, lagMs: number) {
    this.halfLag = Math.max(0, lagMs) / 2;
    this.socket = new WebSocket(url);
    this.socket.binaryType = 'arraybuffer';
    this.socket.onopen = () => this.setStatus('open');
    this.socket.onclose = (e) => {
      this.closeReason = e.reason;
      this.closeCode = e.code;
      this.setStatus('closed');
    };
    this.socket.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      const data = e.data;
      if (this.halfLag > 0) setTimeout(() => this.inbox.push(data), this.halfLag);
      else this.inbox.push(data);
    };
  }

  send(data: Message): void {
    if (this.status !== 'open') return;
    if (this.halfLag > 0) setTimeout(() => this.sendNow(data), this.halfLag);
    else this.sendNow(data);
  }

  /** Закрыть соединение (уходим со страницы — комната сразу узнает, что нас нет). */
  close(): void {
    this.socket.close(1000, 'bye');
  }

  private sendNow(data: Message): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(data);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.onStatus(status);
  }
}
