/* ДЕМО-ДАННЫЕ личного кабинета. Всё вымышленное (почта example.com — зарезервированный адрес).
   Срок доступа, клиент, оплаты, группы и видео уже с сервера. Здесь остаются только материалы (до фазы 5). */
window.LK_DATA = {
  demo: true,
  extras: [
    { id: 'guide-emotions', kind: 'гайд',        title: 'Как перестать заедать эмоции?',                   cover: '../assets/img/cover-guide.webp', owned: true,  href: '../guide-zaedanie.html',  price: '899 ₽' },
    { id: 'video-alcohol',  kind: 'видео-разбор', title: 'Как не отказывать себе в алкоголе при похудении?', cover: '../assets/img/cover-video.webp', owned: false, href: '../video-alkogol.html', price: '899 ₽' }
  ]
};

/* Общее хранилище демо: админка пишет сюда правки контента, кабинет клиента их показывает.
   Когда появится бэкенд, оба читают один и тот же API, а этот блок удаляется. */
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('nika_demo_content') || 'null');
    if (!s) return;
    var D = window.LK_DATA;
    D.all = s;
    if (s.extras) D.extras = s.extras.filter(function (x) { return x.on !== false; }).map(function (x) {
      var y = Object.assign({}, x);
      if (typeof y.price === 'number') y.price = y.price.toLocaleString('ru-RU') + ' ₽';
      return y;
    });
  } catch (e) {}
})();
