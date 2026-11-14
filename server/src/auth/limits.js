// Лимиты попыток в памяти процесса. Сервер один, этого достаточно; после перезапуска счётчики обнуляются.
// Лимиты на отправку кодов считаются по базе (login_codes) и переживают перезапуск.
export class Limiter {
  constructor({ max, windowMs }) { this.max = max; this.windowMs = windowMs; this.map = new Map(); }
  #get(key) {
    const now = Date.now();
    let e = this.map.get(key);
    if (!e || e.reset <= now) { e = { n: 0, reset: now + this.windowMs }; this.map.set(key, e); }
    return e;
  }
  blocked(key) { return this.#get(key).n >= this.max; }
  hit(key) { this.#get(key).n += 1; }
  clear(key) { this.map.delete(key); }
  // Сколько минут осталось ждать (для текста ошибки), минимум 1
  waitMin(key) { return Math.max(1, Math.ceil((this.#get(key).reset - Date.now()) / 60e3)); }
  sweep() { const now = Date.now(); for (const [k, e] of this.map) if (e.reset <= now) this.map.delete(k); }
}

// Сколько кодов можно запросить
export const CODE_LIMITS = {
  perEmail15m: 3,   // на одну почту за 15 минут
  perEmailDay: 10,  // на одну почту за сутки
  perIp15m: 10,     // с одного адреса за 15 минут
};

// Вход по паролю. Считаем неудачи на пару «почта + адрес»: чужие попытки с другого адреса не запирают владельца.
// perEmail — запасной общий потолок на почту со всех адресов: защита от перебора с множества адресов.
export const PASS_LIMITS = {
  perPair: { max: 10, windowMs: 5 * 60e3 },
  perIp: { max: 20, windowMs: 15 * 60e3 },
  perEmail: { max: 50, windowMs: 15 * 60e3 },
};
