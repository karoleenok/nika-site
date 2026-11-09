/* ДЕМО-ДАННЫЕ личного кабинета. Всё вымышленное (почта example.com — зарезервированный адрес).
   Когда появится бэкенд, этот файл заменяется ответом API с теми же полями. */
window.LK_DATA = {
  demo: true,
  client: { name: 'Анна', email: 'anna@example.com' },
  plan: { name: '2 месяца', span: 56 },          // span — длительность тарифа в днях (для демо-дат)
  groups: [
    { id: 'legs',      name: 'Ноги' },
    { id: 'glutes',    name: 'Ягодицы' },
    { id: 'back',      name: 'Спина' },
    { id: 'arms',      name: 'Руки' },
    { id: 'shoulders', name: 'Плечи' },
    { id: 'abs',       name: 'Пресс' }
  ],
  videos: [
    { id: 'v01', group: 'legs',      title: 'Приседания: техника и дыхание', min: 12, level: 'базовый',  gear: ['коврик'], text: 'Разбираем постановку стоп, глубину и положение корпуса. Смотри целиком до первой тренировки.' },
    { id: 'v02', group: 'legs',      title: 'Выпады на месте',               min: 14, level: 'средний',  gear: ['коврик', 'гантели'], text: 'Как держать колено и не терять равновесие. Показаны лёгкий и усложнённый варианты.' },
    { id: 'v03', group: 'glutes',    title: 'Ягодичный мостик',              min: 10, level: 'базовый',  gear: ['коврик'], text: 'Включаем нужные мышцы без нагрузки на поясницу. Подходит для разминки.' },
    { id: 'v04', group: 'glutes',    title: 'Отведение ноги с резинкой',     min: 16, level: 'средний',  gear: ['мини-резинка'], text: 'Рабочая тренировка на ягодичные с мини-резинкой. Темп и пауза показаны на видео.' },
    { id: 'v05', group: 'back',      title: 'Тяга резинки к поясу',          min: 13, level: 'базовый',  gear: ['длинная резинка'], text: 'Учимся чувствовать лопатки. Без рывков, с контролем возврата.' },
    { id: 'v06', group: 'back',      title: 'Осанка: пять упражнений',       min: 18, level: 'базовый',  gear: ['коврик'], text: 'Короткий комплекс для тех, кто много сидит. Можно делать каждый день.' },
    { id: 'v07', group: 'arms',      title: 'Разгибания на трицепс',         min: 11, level: 'средний',  gear: ['гантели'], text: 'Как подобрать вес и не раскачивать корпус.' },
    { id: 'v08', group: 'arms',      title: 'Сгибания на бицепс',            min: 11, level: 'базовый',  gear: ['гантели'], text: 'Классика с акцентом на медленный опускающий ход.' },
    { id: 'v09', group: 'shoulders', title: 'Жим гантелей сидя',             min: 15, level: 'средний',  gear: ['гантели', 'скамья'], text: 'Постановка плеч и траектория. Что делать, если щёлкает сустав.' },
    { id: 'v10', group: 'shoulders', title: 'Махи в стороны',                min: 9,  level: 'базовый',  gear: ['гантели'], text: 'Лёгкая тренировка на средние пучки дельт.' },
    { id: 'v11', group: 'abs',       title: 'Скручивания без рывков',        min: 10, level: 'базовый',  gear: ['коврик'], text: 'Дыхание и положение шеи. Три уровня сложности.' },
    { id: 'v12', group: 'abs',       title: 'Планка: три варианта',          min: 12, level: 'средний',  gear: ['коврик'], text: 'От планки на коленях до боковой. Выбирай по самочувствию.' }
  ],
  extras: [
    { id: 'guide-emotions', kind: 'гайд',        title: 'Как перестать заедать эмоции?',                   cover: '../assets/img/cover-guide.webp', owned: true,  href: '../guide-zaedanie.html',  price: '899 ₽' },
    { id: 'video-alcohol',  kind: 'видео-разбор', title: 'Как не отказывать себе в алкоголе при похудении?', cover: '../assets/img/cover-video.webp', owned: false, href: '../video-alkogol.html', price: '899 ₽' }
  ],
  payments: [
    { date: '2026-11-01', title: 'Тариф «2 месяца»', sum: '17 999 ₽' },
    { date: '2026-11-01', title: 'Гайд «Как перестать заедать эмоции?»', sum: '899 ₽' }
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
