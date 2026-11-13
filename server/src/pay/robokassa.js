// Robokassa: ссылка на оплату и проверка уведомлений. По документации docs.robokassa.ru (проверено 13.11.2026):
//   оплата:     MD5(MerchantLogin:OutSum:InvId:Receipt:Пароль#1), Receipt перед подписью URL-кодируется
//   ResultURL:  MD5(OutSum:InvId:Пароль#2), ответ OK{InvId}
//   SuccessURL: MD5(OutSum:InvId:Пароль#1)
// Своих параметров Shp_ не передаём: заказ однозначно находится по InvId, а порядок Shp_ в подписи в документации не описан.
import crypto from 'node:crypto';

export const PAY_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx';
export const MAX_INV_ID = 2147483647;

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

// Сравнение подписей: регистр не важен (в документации встречаются оба), время сравнения постоянное
export function sameSign(a, b) {
  const x = Buffer.from(String(a).toLowerCase()), y = Buffer.from(String(b).toLowerCase());
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const kopToSum = (kop) => `${Math.floor(kop / 100)}.${String(kop % 100).padStart(2, '0')}`;

// "100.000000" → 10000. Только цифры и точка, без округлений через float.
export function sumToKop(s) {
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const frac = (m[2] || '').padEnd(6, '0');
  if (!/^\d{2}0{4}$/.test(frac)) return null;   // доли копейки — не наша сумма
  return Number(m[1]) * 100 + Number(frac.slice(0, 2));
}

// Чек для «Робочеков СМЗ»: одна позиция-услуга на всю сумму, без НДС.
// Без Receipt Robokassa не формирует чек самозанятого (операция повисает с «не передали номенклатуру»).
export function receiptFor({ name, kop }) {
  return {
    items: [{
      name: String(name).replace(/\s+/g, ' ').trim().slice(0, 128),   // в документации до 128 символов
      quantity: 1,
      sum: Number(kopToSum(kop)),
      payment_method: 'full_payment',
      payment_object: 'service',
      tax: 'none',
    }],
  };
}

export function paymentUrl(cfg, { invId, kop, description, email, name }) {
  const outSum = kopToSum(kop);
  const receipt = encodeURIComponent(JSON.stringify(receiptFor({ name, kop })));
  const sign = md5(`${cfg.login}:${outSum}:${invId}:${receipt}:${cfg.password1}`);
  const q = new URLSearchParams({
    MerchantLogin: cfg.login, OutSum: outSum, InvId: String(invId),
    Description: String(description).slice(0, 100),
    Receipt: receipt,          // URLSearchParams закодирует ещё раз: Robokassa раскодирует один раз и получит то, что в подписи
    SignatureValue: sign, Culture: 'ru', Encoding: 'utf-8',
  });
  if (email) q.set('Email', email);
  if (cfg.test) q.set('IsTest', '1');
  return `${PAY_URL}?${q}`;
}

export function resultSignOk(cfg, { OutSum, InvId, SignatureValue }) {
  if (!OutSum || !InvId || !SignatureValue) return false;
  return sameSign(md5(`${OutSum}:${InvId}:${cfg.password2}`), SignatureValue);
}

export function successSignOk(cfg, { OutSum, InvId, SignatureValue }) {
  if (!OutSum || !InvId || !SignatureValue) return false;
  return sameSign(md5(`${OutSum}:${InvId}:${cfg.password1}`), SignatureValue);
}

// Для тестов: подпись, какую прислала бы Robokassa
export const signResult = (cfg, outSum, invId) => md5(`${outSum}:${invId}:${cfg.password2}`);
