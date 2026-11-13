import { hash, verify } from '@node-rs/argon2';

// argon2id с параметрами из рекомендаций OWASP (m=19 МиБ, t=2, p=1)
const OPTS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw) => hash(pw, OPTS);
export const checkPassword = async (stored, pw) => { try { return await verify(stored, pw); } catch { return false; } };

// Когда почты нет в базе, всё равно считаем хеш: ответ приходит за то же время
let dummy;
export async function burnTime(pw) { dummy ??= await hashPassword('dummy-password-for-timing'); await checkPassword(dummy, pw); }

// Частые пароли из открытых утечек (латиница и та же раскладка по-русски) плюс клавиатурные ряды
const COMMON = new Set(`12345678 123456789 1234567890 0123456789 87654321 987654321 11111111 00000000 22222222 88888888
12341234 11223344 1q2w3e4r 1q2w3e4r5t q1w2e3r4 qwertyui qwerty123 qwerty12 qwertyuiop asdfghjk asdfghjkl zxcvbnm1
qazwsxedc 1qaz2wsx zaq12wsx password password1 password12 password123 passw0rd iloveyou princess sunshine football
baseball superman starwars dragon12 monkey12 letmein1 welcome1 trustno1 abc12345 abcd1234 aa123456 a1234567 12345qwe
123qwe123 qwe12345 123123123 147258369 159753456 789456123 18atcskd2w 3rjs1la7qe 1g2w3e4r gfhjkm123 йцукенгш
йцукенгшщз фывапрол фывапролд пароль123 пароль12 qwerty1234 1qazxsw2 zxcvbnma marina123 natasha1 nikita12
anastasia margarita alexandr kristina vladimir aleksandr dmitriy1 sergey12 andrey12 tatyana1 svetlana elena123
olga1234 irina123 natali12 lyubov12 nadezhda samsung1 xiaomi12 iphone12 vkontakte odnoklassniki yandex12 google12
fitness1 fitnes12 trener12 sport123 hudeem12 krasota1 lovelove loveyou1 solnyshko kotenok1 zaika123 malyshka`
  .split(/\s+/).filter(Boolean));

// Возвращает текст ошибки или пустую строку
export function passwordProblem(pw, email) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Пароль короче 8 символов.';
  if (pw.length > 128) return 'Пароль длиннее 128 символов.';
  const low = pw.toLowerCase();
  if (/^(.)\1+$/.test(pw) || COMMON.has(low)) return 'Слишком простой пароль, такие подбирают первыми. Придумай другой.';
  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length > 2 && low.includes(local)) return 'В пароле не должно быть части почты.';
  return '';
}
