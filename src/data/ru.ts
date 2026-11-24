import type {
  ContactChannel,
  HighlightCard,
  NavItem,
  Picture,
  Principle,
  Project,
  ProjectCategory,
  Service,
  Stage,
} from './types';

/**
 * All Russian copy of the site. An English version is added as a sibling file (en.ts)
 * with the same shape and registered in ./index.ts.
 *
 * Values wrapped in { placeholder } are not confirmed by the company yet and are shown
 * on the site as visibly marked gaps. Replace them with real data before launch.
 */

const company = {
  name: 'BUSINESS STAND',
  tagline: 'Проектирование, производство и застройка выставочных стендов',
  description:
    'BUSINESS STAND проектирует, производит и строит индивидуальные выставочные стенды для компаний, участвующих в выставках и деловых событиях.',
};

const nav: NavItem[] = [
  { label: 'Проекты', href: '/#projects' },
  { label: 'Услуги', href: '/#services' },
  { label: 'Как работаем', href: '/#approach' },
  { label: 'Портфолио', href: '/projects/', portfolio: true },
  { label: 'Контакты', href: '/#contact' },
];

const hero = {
  title: ['Выставочные стенды', 'под ключ'],
  text: 'Проектируем, производим и строим стенды, которые выделяют ваш бренд.',
  primary: { label: 'Обсудить проект →', href: '/#contact' },
  secondary: { label: 'Наши проекты ↓', href: '/#projects' },
  imageAlt:
    'Выставочное пространство с полупрозрачными перегородками, металлическими рамными конструкциями и экранами',
};

const highlights: HighlightCard[] = [
  {
    id: 'design',
    title: 'Дизайн и проектирование',
    text: 'От концепции до 3D-визуализации.',
    icon: 'DraftingCompass',
    href: '/#service-design',
  },
  {
    id: 'build',
    title: 'Производство и застройка',
    text: 'Изготовление и монтаж стендов.',
    icon: 'Construction',
    href: '/#service-fabrication',
  },
  {
    id: 'turnkey',
    title: 'Решения под ключ',
    text: 'Полная координация проекта.',
    icon: 'Workflow',
    href: '/#approach',
  },
];

const about = {
  title: 'Пространство, в котором бренд становится заметным',
  lead: 'Дизайн, инженерия и собственное производство в одной команде. Один менеджер ведёт проект от эскиза до демонтажа.',
  images: {
    main: {
      image: 'aboutSpace',
      alt: 'Пустой светлый зал перед застройкой экспозиции',
    } satisfies Picture,
    secondary: {
      image: 'aboutHall',
      alt: 'Просторный выставочный зал с колоннами и мягким потолочным светом',
    } satisfies Picture,
  },
};

const services: Service[] = [
  {
    id: 'service-design',
    title: 'Дизайн стенда',
    text: 'Концепция, планировка и архитектура.',
    picture: {
      image: 'serviceDesign',
      alt: 'Архитектурные макеты на белых подиумах в светлом холле',
    },
  },
  {
    id: 'service-engineering',
    title: '3D и инженерия',
    text: 'Визуализации и рабочие чертежи.',
    picture: {
      image: 'service3d',
      alt: 'Трёхмерная визуализация компактного стенда с экраном и подсвеченной зоной',
    },
  },
  {
    id: 'service-fabrication',
    title: 'Производство',
    text: 'Конструкции, мебель и отделка.',
    picture: {
      image: 'serviceFabrication',
      alt: 'Мастер собирает деревянную конструкцию в мастерской',
    },
  },
  {
    id: 'service-installation',
    title: 'Застройка и монтаж',
    text: 'Монтаж на площадке в срок.',
    picture: {
      image: 'serviceInstallation',
      alt: 'Монтажная бригада размечает пространство в пустом выставочном зале',
    },
  },
  {
    id: 'service-media',
    title: 'Свет и мультимедиа',
    text: 'Освещение, графика и экраны.',
    picture: {
      image: 'serviceLighting',
      alt: 'Направленные светильники на подвесной ферме',
    },
  },
  {
    id: 'service-logistics',
    title: 'Логистика и демонтаж',
    text: 'Доставка, хранение и вывоз.',
    picture: {
      image: 'serviceLogistics',
      alt: 'Высокие складские стеллажи с упакованными грузами',
    },
  },
];

/**
 * Stand formats. The company builds exhibition stands only, in Russia only: every format is a
 * kind of stand. The ids are stored with each project; 'pavilion' and 'international' are kept
 * from earlier names so existing projects stay valid — only their labels are shown.
 */
const projectCategories: ProjectCategory[] = [
  { id: 'island', label: 'Островные стенды', short: 'Островные' },
  { id: 'corner', label: 'Угловые стенды', short: 'Угловые' },
  { id: 'pavilion', label: 'Иммерсивные стенды', short: 'Иммерсивные' },
  { id: 'modular', label: 'Модульные системы', short: 'Модульные' },
  { id: 'product', label: 'Презентация продукта', short: 'Презентация продукта' },
  { id: 'international', label: 'Демонстрационные стенды', short: 'Демонстрационные' },
];

const sampleClient = { placeholder: 'Название клиента' };
const sampleEvent = { placeholder: 'Название выставки' };
const sampleArea = { placeholder: '— м²' };
const sampleYear = { placeholder: '20__' };

const projects: Project[] = [
  {
    slug: 'island-stand',
    title: 'Стенд с изогнутой стеной',
    category: 'island',
    summary:
      'Стенд, открытый с четырёх сторон: изогнутая стена-доминанта, переговорная зона в центре и подиум на всю площадь застройки.',
    client: sampleClient,
    event: sampleEvent,
    area: sampleArea,
    year: sampleYear,
    picture: {
      image: 'projectIsland',
      alt: 'Визуализация стенда: изогнутая светлая стена, стол с жёлтыми стульями и деревянные полки на круглом подиуме',
    },
    story: [
      {
        heading: 'Задача',
        text: 'Создать стенд, который читается из любой точки зала и даёт команде спокойное место для переговоров посреди выставочного потока.',
      },
      {
        heading: 'Решение',
        text: 'Изогнутая стена-доминанта задаёт центр композиции и закрывает переговорную зону от прохода, не изолируя её. Подиум объединяет площадь стенда и скрывает коммуникации.',
      },
      {
        heading: 'Реализация',
        text: 'Каркас и отделка изготавливаются в производстве, на площадке стенд собирается из готовых узлов, что сокращает время монтажа.',
      },
    ],
    scope: ['Концепция и 3D-визуализация', 'Рабочая документация', 'Производство', 'Монтаж и демонтаж'],
    illustrative: true,
  },
  {
    slug: 'corner-stand',
    title: 'Лаунж и медиастена',
    category: 'corner',
    summary:
      'Две открытые стороны, лаунж для гостей и медиастена с контурной подсветкой, которая работает на дальнюю дистанцию.',
    client: sampleClient,
    event: sampleEvent,
    area: sampleArea,
    year: sampleYear,
    picture: {
      image: 'projectCorner',
      alt: 'Визуализация углового стенда с диваном, экраном на стене и красной контурной подсветкой',
    },
    story: [
      {
        heading: 'Задача',
        text: 'Использовать угловое расположение на пересечении проходов и обеспечить место для неформального общения с гостями.',
      },
      {
        heading: 'Решение',
        text: 'Медиастена с экраном развёрнута к главному проходу, а мягкая зона ориентирована вглубь стенда. Контурная подсветка выделяет стенд на фоне соседних экспозиций.',
      },
      {
        heading: 'Реализация',
        text: 'Скрытая разводка электричества и мультимедиа, интеграция экрана и светодиодных профилей в конструкцию стены.',
      },
    ],
    scope: ['Дизайн-проект', 'Интеграция мультимедиа', 'Сценарий освещения', 'Застройка'],
    illustrative: true,
  },
  {
    slug: 'immersive-stand',
    title: 'Иммерсивный стенд',
    category: 'pavilion',
    summary:
      'Стенд с проекционной графикой на полупрозрачных поверхностях: пространство, через которое посетитель проходит как через сценарий.',
    client: sampleClient,
    event: sampleEvent,
    area: sampleArea,
    year: sampleYear,
    picture: {
      image: 'projectPavilion',
      alt: 'Проекционная графика на полупрозрачных занавесах в затемнённом пространстве стенда',
    },
    story: [
      {
        heading: 'Задача',
        text: 'Превратить стенд в отдельное событие внутри выставки, которое запоминается и о котором рассказывают.',
      },
      {
        heading: 'Решение',
        text: 'Последовательность пространств с проекциями и светом ведёт посетителя по маршруту, а графика меняется по ходу движения.',
      },
      {
        heading: 'Реализация',
        text: 'Проектирование затемнённого объёма, подбор проекционного оборудования и согласование технических решений с организатором.',
      },
    ],
    scope: ['Концепция стенда', 'Мультимедиа и проекции', 'Свет', 'Производство и монтаж'],
    illustrative: true,
  },
  {
    slug: 'modular-system',
    title: 'Модульная экспозиция',
    category: 'modular',
    summary:
      'Модульная система из повторяющихся элементов, которую можно пересобирать под разные выставки и площади.',
    client: sampleClient,
    event: sampleEvent,
    area: sampleArea,
    year: sampleYear,
    picture: {
      image: 'projectModular',
      alt: 'Белая модульная экспозиция из кубических ячеек с выставленными предметами',
    },
    story: [
      {
        heading: 'Задача',
        text: 'Создать экспозицию, которая используется на нескольких выставках в течение года без потери качества.',
      },
      {
        heading: 'Решение',
        text: 'Сетка из повторяющихся модулей образует витрины, стены и стойки. Конфигурация меняется под площадь, а образ бренда сохраняется.',
      },
      {
        heading: 'Реализация',
        text: 'Узлы соединений рассчитаны на многократную сборку, для элементов предусмотрены транспортировочная упаковка и хранение между выставками.',
      },
    ],
    scope: ['Разработка модульной системы', 'Производство', 'Хранение', 'Повторные монтажи'],
    illustrative: true,
  },
  {
    slug: 'product-presentation',
    title: 'Световые витрины',
    category: 'product',
    summary:
      'Затемнённый объём со световыми витринами: продукт становится главным источником света на стенде.',
    client: sampleClient,
    event: sampleEvent,
    area: sampleArea,
    year: sampleYear,
    picture: {
      image: 'projectProduct',
      alt: 'Подсвеченные стеклянные витрины с экспонатами в затемнённом пространстве',
    },
    story: [
      {
        heading: 'Задача',
        text: 'Показать продукт крупным планом и создать камерную атмосферу для презентаций.',
      },
      {
        heading: 'Решение',
        text: 'Витрины с подсветкой изнутри и тёмная отделка стен концентрируют внимание на экспонатах и снижают визуальный шум выставки.',
      },
      {
        heading: 'Реализация',
        text: 'Изготовление витрин со стеклом и встроенным светом, расчёт защищённого размещения экспонатов.',
      },
    ],
    scope: ['Дизайн экспозиции', 'Производство витрин', 'Свет', 'Монтаж'],
    illustrative: true,
  },
  {
    slug: 'demo-stand',
    title: 'Интерактивный стол',
    category: 'international',
    summary:
      'Демонстрационный стенд с длинным интерактивным столом и экранами для показа продукта на отраслевой выставке.',
    client: sampleClient,
    event: sampleEvent,
    area: sampleArea,
    year: sampleYear,
    picture: {
      image: 'projectInternational',
      alt: 'Длинный демонстрационный стол со встроенными светящимися экранами',
    },
    story: [
      {
        heading: 'Задача',
        text: 'Подготовить стенд с учётом требований организатора выставки и сроков доставки.',
      },
      {
        heading: 'Решение',
        text: 'Демонстрационный стол с интерактивными экранами позволяет нескольким посетителям одновременно изучать продукт.',
      },
      {
        heading: 'Реализация',
        text: 'Документация по требованиям организатора, упаковка и доставка конструкций, монтаж и демонтаж на площадке.',
      },
    ],
    scope: ['Проектирование', 'Мультимедиа', 'Логистика', 'Монтаж и демонтаж'],
    illustrative: true,
  },
];

const stages: Stage[] = [
  {
    number: '01',
    title: 'Бриф',
    text: 'Цели, площадь, бюджет и сроки.',
  },
  {
    number: '02',
    title: 'Концепция',
    text: 'Планировка, дизайн и визуализация.',
  },
  {
    number: '03',
    title: 'Производство',
    text: 'Рабочие чертежи и изготовление.',
  },
  {
    number: '04',
    title: 'Монтаж',
    text: 'Доставка и застройка на площадке.',
  },
  {
    number: '05',
    title: 'Сдача и демонтаж',
    text: 'Стенд готов к открытию, затем вывоз.',
  },
];

const why = {
  title: 'Качество в каждой детали',
  text: 'Месяцы подготовки ради нескольких дней выставки — без сюрпризов на площадке.',
  principles: [
    {
      title: 'Под ваш бренд',
      text: 'Проект от целей участия, а не из каталога.',
    },
    {
      title: 'Инженерная точность',
      text: 'Каждое решение проверяет конструктор.',
    },
    {
      title: 'Внимание к деталям',
      text: 'Стыки, кромки и свет продуманы вблизи.',
    },
    {
      title: 'Один график',
      text: 'Дизайн, производство и монтаж в одних руках.',
    },
  ] satisfies Principle[],
};

const contact = {
  title: 'Давайте создадим стенд, который запомнят',
  text: 'Расскажите о выставке — предложим решение.',
  imageAlt: 'Светлый пустой зал с белыми колоннами, готовый к застройке',
  messengersTitle: 'Быстрее всего — в мессенджере',
  formTitle: 'Или оставьте заявку',
  channels: [
    { label: 'Телефон', value: { placeholder: '+7 (000) 000-00-00' } },
    { label: 'Почта', value: { placeholder: 'info@company.ru' } },
    { label: 'Адрес', value: { placeholder: 'Город, улица, дом' } },
  ] satisfies ContactChannel[],
};

const form = {
  fields: {
    name: { label: 'Имя', placeholder: 'Как к вам обращаться' },
    company: { label: 'Компания', placeholder: 'Название компании' },
    email: { label: 'Почта', placeholder: 'name@company.ru' },
    phone: { label: 'Телефон', placeholder: '+7 900 123-45-67' },
    contact: { legend: 'Как с вами связаться', hint: 'Укажите почту или телефон — достаточно одного.' },
    event: { label: 'Выставка или событие', placeholder: 'Название и даты' },
    area: { label: 'Площадь стенда, м²', placeholder: 'Например, 36' },
    message: {
      label: 'О проекте',
      placeholder: 'Задачи, формат стенда, сроки',
    },
    file: {
      label: 'Бриф или техническое задание',
      button: 'Прикрепить файл',
      hint: 'PDF, DOC, PPT, XLS, JPG, PNG или ZIP, до 10 МБ',
      remove: 'Удалить файл',
    },
    consent: {
      before: 'Даю ',
      consent: 'согласие на обработку персональных данных',
      middle: ' ООО «Бизнесстенд» в соответствии с ',
      policy: 'Политикой обработки персональных данных',
    },
  },
  optional: 'необязательно',
  submit: 'Отправить заявку →',
  sending: 'Отправляем…',
  errors: {
    required: 'Заполните это поле',
    name: 'Укажите имя — хотя бы две буквы',
    email: 'Введите адрес в формате name@company.ru',
    phone: 'Введите номер телефона, например +7 900 123-45-67',
    contact: 'Укажите почту или телефон, чтобы мы могли с вами связаться',
    area: 'Укажите площадь числом, например 36',
    consent: 'Подтвердите согласие на обработку данных',
    fileSize: 'Файл больше 10 МБ. Прикрепите файл меньшего размера или отправьте ссылку в описании',
    fileType: 'Этот формат не поддерживается. Прикрепите PDF, DOC, PPT, XLS, JPG, PNG или ZIP',
    summary: 'Проверьте отмеченные поля',
  },
  status: {
    success: {
      title: 'Заявка отправлена',
      text: 'Мы получили заявку и свяжемся с вами по указанным контактам.',
    },
    error: {
      title: 'Заявка не отправлена',
      text: 'Сервер не принял заявку. Проверьте подключение к интернету и отправьте ещё раз.',
    },
  },
};

const projectsSection = {
  title: 'Наши проекты',
  text: 'Выставочные пространства, созданные для брендов.',
  notice: '',
  filterLabel: 'Фильтр по формату',
  all: 'Все форматы',
  allProjects: 'Все проекты',
  catalogTitle: 'Проекты — BUSINESS STAND',
  open: 'Подробнее о проекте',
  labels: {
    client: 'Клиент',
    event: 'Выставка',
    location: 'Город',
    area: 'Площадь',
    year: 'Год',
    format: 'Формат',
    scope: 'Что входило в работу',
    gallery: 'Фотографии проекта',
  },
  back: '← Все проекты',
  next: 'Следующий проект',
  /** The portfolio menu opened from «Портфолио» in the navigation. */
  menu: {
    title: 'Портфолио',
    close: 'Закрыть',
    filterLabel: 'Формат стенда',
    all: 'Все форматы',
    /** Project count: one, few (2–4), many. */
    count: ['проект', 'проекта', 'проектов'],
    contact: 'Обсудить проект',
  },
  /** Homepage project viewer and its detail window. */
  viewer: {
    listLabel: 'Выбор проекта',
    details: 'Подробнее о проекте',
    page: 'Страница проекта',
    close: 'Закрыть',
    previous: 'Предыдущее фото',
    nextImage: 'Следующее фото',
    photo: 'Фото',
    of: 'из',
  },
  cta: 'Обсудить похожий проект →',
};

const footer = {
  description: 'Выставочные стенды под ключ: дизайн, производство, застройка.',
  navTitle: 'Навигация',
  servicesTitle: 'Услуги',
  contactTitle: 'Контакты',
  social: [
    { label: 'Telegram', value: { placeholder: 'Telegram' } },
    { label: 'VK', value: { placeholder: 'VK' } },
  ] satisfies ContactChannel[],
  privacy: 'Политика обработки персональных данных',
  rights: 'Все права защищены.',
};

const ui = {
  skip: 'Перейти к содержанию',
  menuOpen: 'Открыть меню',
  menuClose: 'Закрыть меню',
  mainNav: 'Основная навигация',
  home: 'BUSINESS STAND — на главную',
  placeholderTitle: 'Данные будут уточнены',
  backHome: '← На главную',
  notFoundTitle: 'Страница не найдена',
  notFoundText: 'Возможно, ссылка устарела или в адресе есть опечатка. Вернитесь на главную или посмотрите проекты.',
  notFoundProjects: 'Смотреть проекты',
};

const meta = {
  home: {
    title: 'BUSINESS STAND — выставочные стенды под ключ',
    description:
      'Проектирование, производство и застройка индивидуальных выставочных стендов: дизайн, 3D-визуализация, производство конструкций, монтаж, логистика и демонтаж.',
  },
  privacy: {
    title: 'Политика обработки персональных данных — BUSINESS STAND',
    description: 'Как ООО «Бизнесстенд» получает, использует и защищает персональные данные, которые вы оставляете на сайте BUSINESS STAND.',
  },
  notFound: {
    title: 'Страница не найдена — BUSINESS STAND',
    description: 'Такой страницы на сайте нет.',
  },
};

export const ru = {
  locale: 'ru',
  htmlLang: 'ru',
  company,
  nav,
  hero,
  highlights,
  about,
  services,
  servicesSection: {
    title: 'Услуги',
    text: 'Все этапы в одних руках — от идеи до демонтажа.',
  },
  projectCategories,
  projects,
  projectsSection,
  approach: {
    title: 'Наш подход',
    text: 'Пять этапов. На каждом вы знаете, что готово и что дальше.',
    stages,
  },
  why,
  contact,
  form,
  footer,
  ui,
  meta,
};

export type SiteContent = typeof ru;
