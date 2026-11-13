// Политика безопасности страниц (CSP). Одна строка для локального сервера, .htaccess и будущего nginx (фаза 6).
// Разрешаем браузеру ходить только к себе и к хранилищу видео: загрузка частей (connect-src) и просмотр (media-src).
export function cspHeader(s3PublicEndpoint) {
  const s3 = new URL(s3PublicEndpoint).origin;
  return [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:", "font-src 'self'",
    `connect-src 'self' ${s3}`, `media-src 'self' ${s3}`,
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
}
