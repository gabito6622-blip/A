// Reloj corrido solo para sacar capturas (copia local): OFFSET_MS se suma a la hora real.
const OFF = Number(process.env.OFFSET_MS || 0);
const RealDate = Date;
function FakeDate(...a) {
  if (!new.target) return new RealDate(RealDate.now() + OFF).toString();
  return Reflect.construct(RealDate, a.length ? a : [RealDate.now() + OFF], new.target);
}
FakeDate.prototype = RealDate.prototype;
Object.defineProperty(FakeDate.prototype, "constructor", { value: FakeDate, writable: true, configurable: true });
FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse; FakeDate.now = () => RealDate.now() + OFF;
globalThis.Date = FakeDate;
