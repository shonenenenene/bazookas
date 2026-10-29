// Запись и чтение бинарных сообщений для сети.
// Бинарь вместо JSON: сообщения в разы короче, и не надо разбирать текст 30–60 раз в секунду.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Готовое сообщение — байты, которые можно отправить в сокет. */
export type Message = Uint8Array<ArrayBuffer>;

/** Пишет числа подряд в буфер. finish() отдаёт готовое сообщение — и можно писать следующее. */
export class Writer {
  private bytes: Message;
  private view: DataView;
  private pos = 0;

  constructor(size = 1024) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u8(v: number): void {
    this.room(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
  }
  i8(v: number): void {
    this.room(1);
    this.view.setInt8(this.pos, v);
    this.pos += 1;
  }
  u16(v: number): void {
    this.room(2);
    this.view.setUint16(this.pos, v);
    this.pos += 2;
  }
  i16(v: number): void {
    this.room(2);
    this.view.setInt16(this.pos, v);
    this.pos += 2;
  }
  u32(v: number): void {
    this.room(4);
    this.view.setUint32(this.pos, v);
    this.pos += 4;
  }
  i32(v: number): void {
    this.room(4);
    this.view.setInt32(this.pos, v);
    this.pos += 4;
  }
  /** Дробное с точностью ~7 знаков — для того, что только рисуется */
  f32(v: number): void {
    this.room(4);
    this.view.setFloat32(this.pos, v);
    this.pos += 4;
  }
  /** Дробное без потерь — для того, с чего клиент продолжает считать физику */
  f64(v: number): void {
    this.room(8);
    this.view.setFloat64(this.pos, v);
    this.pos += 8;
  }
  bool(v: boolean): void {
    this.u8(v ? 1 : 0);
  }
  /** Строка: длина в байтах + UTF-8. Не длиннее 255 байт. */
  str(s: string): void {
    const b = encoder.encode(s).subarray(0, 255);
    this.u8(b.length);
    this.room(b.length);
    this.bytes.set(b, this.pos);
    this.pos += b.length;
  }

  /** Готовое сообщение. Это копия, так что буфер сразу можно писать заново. */
  finish(): Message {
    const out = this.bytes.slice(0, this.pos);
    this.pos = 0;
    return out;
  }

  /** Места не хватает — увеличиваем буфер вдвое */
  private room(n: number): void {
    if (this.pos + n <= this.bytes.length) return;
    const bigger = new Uint8Array(Math.max(this.bytes.length * 2, this.pos + n));
    bigger.set(this.bytes);
    this.bytes = bigger;
    this.view = new DataView(bigger.buffer);
  }
}

/** Читает числа из сообщения в том же порядке, в каком их писал Writer. */
export class Reader {
  private bytes: Uint8Array = new Uint8Array(0);
  private view = new DataView(this.bytes.buffer);
  private pos = 0;

  /** Начать читать новое сообщение (Reader можно переиспользовать). */
  reset(data: ArrayBuffer | Uint8Array): this {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.pos = 0;
    return this;
  }

  u8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }
  i8(): number {
    const v = this.view.getInt8(this.pos);
    this.pos += 1;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.pos);
    this.pos += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  i32(): number {
    const v = this.view.getInt32(this.pos);
    this.pos += 4;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.pos);
    this.pos += 4;
    return v;
  }
  f64(): number {
    const v = this.view.getFloat64(this.pos);
    this.pos += 8;
    return v;
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  str(): string {
    const len = this.u8();
    if (this.pos + len > this.bytes.length) throw new RangeError('строка обрезана');
    const s = decoder.decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
}
