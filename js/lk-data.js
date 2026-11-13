/* ДЕМО-ДАННЫЕ личного кабинета. Всё вымышленное (почта example.com — зарезервированный адрес).
   Срок доступа, клиент и оплаты уже с сервера. Здесь остаются видео и материалы (фаза 3). */
window.LK_DATA = {
  demo: true,
  /* Группы повторяют папки на Диске Ники: грудь/руки, ноги, плиометрика, пресс, разминка, спина */
  groups: [
    { id: 'chest',   name: 'Грудь/руки' },
    { id: 'legs',    name: 'Ноги' },
    { id: 'plyo',    name: 'Плиометрика' },
    { id: 'abs',     name: 'Пресс' },
    { id: 'warmup',  name: 'Разминка' },
    { id: 'back',    name: 'Спина' }
  ],
  videos: [
    { id: 'v01', group: 'legs',      title: 'Приседания: техника и дыхание',  gear: ['коврик'], text: 'Разбираем постановку стоп, глубину и положение корпуса. Смотри целиком до первой тренировки.' },
    { id: 'v02', group: 'legs',      title: 'Выпады на месте',                gear: ['коврик', 'гантели'], text: 'Как держать колено и не терять равновесие. Показаны лёгкий и усложнённый варианты.' },
    { id: 'v03', group: 'legs',    title: 'Ягодичный мостик',               gear: ['коврик'], text: 'Включаем нужные мышцы без нагрузки на поясницу. Подходит для разминки.' },
    { id: 'v04', group: 'legs',    title: 'Отведение ноги с резинкой',      gear: ['мини-резинка'], text: 'Рабочая тренировка на ягодичные с мини-резинкой. Темп и пауза показаны на видео.' },
    { id: 'v05', group: 'back',      title: 'Тяга резинки к поясу',           gear: ['длинная резинка'], text: 'Учимся чувствовать лопатки. Без рывков, с контролем возврата.' },
    { id: 'v06', group: 'back',      title: 'Осанка: пять упражнений',        gear: ['коврик'], text: 'Короткий комплекс для тех, кто много сидит. Можно делать каждый день.' },
    { id: 'v07', group: 'chest',      title: 'Разгибания на трицепс',          gear: ['гантели'], text: 'Как подобрать вес и не раскачивать корпус.' },
    { id: 'v08', group: 'chest',      title: 'Сгибания на бицепс',             gear: ['гантели'], text: 'Классика с акцентом на медленный опускающий ход.' },
    { id: 'v09', group: 'chest', title: 'Жим гантелей сидя',              gear: ['гантели', 'скамья'], text: 'Постановка плеч и траектория. Что делать, если щёлкает сустав.' },
    { id: 'v10', group: 'chest', title: 'Махи в стороны',                 gear: ['гантели'], text: 'Лёгкая тренировка на средние пучки дельт.' },
    { id: 'v11', group: 'abs',       title: 'Скручивания без рывков',         gear: ['коврик'], text: 'Дыхание и положение шеи. Три уровня сложности.' },
    { id: 'v12', group: 'abs',       title: 'Планка: три варианта',           gear: ['коврик'], text: 'От планки на коленях до боковой. Выбирай по самочувствию.' },
    { id: 'v13', group: 'warmup', title: 'Разминка перед тренировкой', gear: ['коврик'], text: 'Короткий комплекс, чтобы разогреть суставы и мышцы до основной части.' },
    { id: 'v14', group: 'plyo',   title: 'Прыжки на месте: мягкое приземление', gear: ['коврик'], text: 'Учимся прыгать без ударной нагрузки на колени.' }
  ],
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
    var hidden = {};
    (s.groups || []).forEach(function (g) { if (g.on === false) hidden[g.id] = true; });
    if (s.groups) D.groups = s.groups.filter(function (g) { return g.on !== false; });
    if (s.videos) D.videos = s.videos.filter(function (v) { return v.on !== false && !hidden[v.group]; });
    if (s.extras) D.extras = s.extras.filter(function (x) { return x.on !== false; }).map(function (x) {
      var y = Object.assign({}, x);
      if (typeof y.price === 'number') y.price = y.price.toLocaleString('ru-RU') + ' ₽';
      return y;
    });
  } catch (e) {}
})();
