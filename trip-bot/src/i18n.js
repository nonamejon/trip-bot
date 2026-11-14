// All text people see, in Uzbek (Latin script) and Russian.
// O = what the owner sees (his chosen language, /uz or /ru). A = what the travel agent sees (AGENT_LANG).
// Admin output and error alerts stay in English and live in flow.js.

export const LANGS = ['uz', 'ru'];
export const normLang = (l) => (LANGS.includes(l) ? l : 'uz');

// Russian plural: plural(5, ['вариант', 'варианта', 'вариантов'])
export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export const PICK_TEXT = 'Tilni tanlang · Выберите язык';
export const PICK_BUTTONS = [[['🇺🇿 Oʻzbekcha', 'lg:uz'], ['🇷🇺 Русский', 'lg:ru']]];

export const COMMANDS = {
  uz: [
    { command: 'status', description: 'Joriy safar holati' },
    { command: 'trips', description: 'Safarlarim' },
    { command: 'passport', description: 'Pasport maʼlumotlarini saqlash (shifrlangan)' },
    { command: 'cancel', description: 'Joriy safarni bekor qilish' },
    { command: 'help', description: 'Yordamchidan qanday foydalanish' },
    { command: 'uz', description: '🇺🇿 Oʻzbek tili' },
    { command: 'ru', description: '🇷🇺 Русский язык' },
  ],
  ru: [
    { command: 'status', description: 'Статус текущей поездки' },
    { command: 'trips', description: 'Мои поездки' },
    { command: 'passport', description: 'Сохранить паспорт (в зашифрованном виде)' },
    { command: 'cancel', description: 'Отменить текущую поездку' },
    { command: 'help', description: 'Как пользоваться помощником' },
    { command: 'uz', description: '🇺🇿 Oʻzbek tili' },
    { command: 'ru', description: '🇷🇺 Русский язык' },
  ],
};

export const STRANGER = (id) => `Bu shaxsiy yordamchi. Bot egasiga soʻrovingiz yuborildi — ruxsat berilsa, shu yerda xabar olasiz. (Telegram ID: <code>${id}</code>)\n\nЭто личный помощник. Владельцу бота отправлен ваш запрос — если доступ дадут, вы получите сообщение здесь. (Telegram ID: <code>${id}</code>)`;

export const O = {
  uz: {
    langSet: 'Til: Oʻzbekcha 🇺🇿',
    help: 'Assalomu alaykum! Men sizning safar yordamchingizman. Qayerga va qachon borishingiz kerakligini matn yoki ovozli xabar bilan yozing — oʻzbek, rus yoki ingliz tilida. Men soʻrovni tayyorlayman, sayohat agentingiz bilan ishlayman, chiptalar va eslatmalarni shu yerda saqlayman.\n\n/passport — pasport maʼlumotlarini saqlash (shifrlangan holda)\n/status — joriy safar holati\n/trips — safarlaringiz\n/cancel — joriy safarni bekor qilish\n/uz · /ru — tilni almashtirish',
    menu: ['Yangi safar', 'Safarlarim', 'Holat'],
    route: 'Yoʻnalish', dates: 'Sanalar', travelers: 'Yoʻlovchilar', flight: 'Parvoz', baggage: 'Bagaj', hotel: 'Mehmonxona', budget: 'Byudjet', notes: 'Izoh',
    nights: (n) => `${n} kecha`,
    noPref: 'farqi yoʻq', notSet: 'belgilanmagan', notStated: 'koʻrsatilmagan', origin: 'Toshkent',
    checkTitle: 'Soʻrovingizni tekshiring',
    passportNote: 'Pasportingiz siz variant tanlamaguningizcha shifrlangan holda saqlanadi.',
    nOptions: (n) => `${n} ta variant`,
    recommended: 'tavsiya etiladi', back: 'Qaytish', cancellation: 'Bekor qilish', why: (l) => `Nega ${l}`,
    booked: 'Bron qilindi', out: 'Ketish', seeVoucher: 'vaucherga qarang', total: 'Jami',
    reminders: 'Eslatmalar', remCheckin: 'onlayn roʻyxatdan oʻtish', remLeave: 'aeroportga yoʻl olish',
    noFlightTime: 'Reys vaqti topilmadi, shuning uchun eslatmalar qoʻyilmadi.',
    steps: { draft: 'Tasdiqlashingiz kutilmoqda', sent: 'Agentda', offers: 'Variantlar tayyor, tanlov sizda', chosen: 'Agent bron qilmoqda', booked: 'Bron qilindi, hujjatlar tayyor', done: 'Safar yakunlandi' },
    collecting: 'Maʼlumotlar yigʻilmoqda',
    agentDue: (time) => `Agent javobi kutilmoqda: ${time} gacha.`,
    trip: 'Safar',
    statusWord: { collecting: 'maʼlumot yigʻilmoqda', draft: 'tasdiq kutilmoqda', sent: 'agentda', offers: 'variantlar tayyor', chosen: 'bron qilinmoqda', booked: 'bron qilindi', done: 'yakunlandi', cancelled: 'bekor qilindi' },
    tooLarge: 'Bu fayl juda katta. Iltimos, 15 MB dan kichik fayl yuboring.',
    canRead: 'Men matn, ovozli xabar, audio fayl, dumaloq video, rasm va PDF fayllarni oʻqiy olaman.',
    passedOn: 'Agentga yetkazdim.',
    readFail: 'Hozir buni oʻqiy olmadim. Iltimos, bir daqiqadan soʻng qayta urinib koʻring.',
    heard: 'Eshitdim',
    needMore: (list) => `Soʻrovni tayyorlash uchun yana kerak: ${list}.`,
    field: { destination: 'qayerga borish', date_from: 'joʻnash sanasi', date_to: 'qaytish sanasi', travelers: 'yoʻlovchilar soni' },
    btnApprove: 'Tasdiqlash va agentga yuborish', btnEdit: 'Tahrirlash', btnCancel: 'Bekor qilish', btnApproveShort: 'Tasdiqlash va yuborish',
    whereWhen: 'Qayerga va qachon borishingiz kerak?',
    whereWhenVoice: 'Qayerga va qachon borishingiz kerak? Matn yoki ovozli xabar yuboring.',
    noTrip: 'Hozir faol safar yoʻq.',
    noTripTell: 'Hozir faol safar yoʻq. Qayerga va qachon borishingiz kerakligini yozing.',
    noCancel: 'Bekor qilinadigan safar yoʻq.',
    passportHow: 'Bitta xabarda yuboring, masalan:\n<code>/passport AZIZBEK UBAYDULLAYEV, FA1234567, 2031-05-01 gacha amal qiladi</code>\nMen uni shifrlab saqlayman, xabaringizni oʻchiraman va agentga faqat siz variant tanlaganingizdan keyin beraman.',
    passportSaved: 'Pasport saqlandi va shifrlandi. Xabaringizni bu chatdan oʻchirdim.',
    unknownCmd: 'Bunday buyruqni bilmayman. /help ni bosing.',
    noTripsYet: 'Hali safarlar yoʻq. Qayerga va qachon borishingiz kerakligini yozing.',
    yourTrips: 'Safarlaringiz',
    notAllowed: 'Ruxsat yoʻq.',
    staleBtn: 'Bu tugma eskirgan.',
    editWhat: 'Nimani oʻzgartiray? Masalan: «13–16-noyabrga oʻzgartir» yoki «ikkinchi yoʻlovchi qilib Boburni qoʻsh».',
    nothingChanged: 'Yaxshi, hech narsa oʻzgarmadi.',
    sentToAgent: (time) => `Agentga yuborildi. Variantlar kelishi bilan xabar beraman (${time} gacha kutilmoqda).`,
    optionGone: 'Bu variant endi mavjud emas.',
    noPassport: 'Pasport maʼlumotlaringiz menda yoʻq. Ularni /passport orqali yuboring yoki agentga bevosita bering.',
    booking: (l) => `Tayyor. Agent bron qilmoqda: ${l}. Chipta va vaucher tayyor boʻlgach, shu yerda paydo boʻladi.`,
    askedOther: 'Agentdan boshqa variantlarni soʻradim.',
    cancelQ: (code, dest) => `${code} — ${dest} safarini bekor qilaymi?`,
    cancelTerms: (l, terms) => `${l} boʻyicha bekor qilish shartlari: ${terms}.`,
    btnYesCancel: 'Ha, bekor qilish', btnKeep: 'Qoldirish',
    cancelled: (code, told) => `${code} safari bekor qilindi.${told ? ' Agentga xabar berdim.' : ''}`,
    agentMsg: 'Agentdan xabar', agentWrote: 'Agent yozdi', fromAgent: 'Agentdan', file: '(fayl)',
    agentUnreadable: (code) => `Agent ${code} boʻyicha javob berdi, lekin uni oʻqiy olmadim. Agentning xabari:`,
    offersPending: (dest, n) => `${dest} boʻyicha ${n} ta variant keldi. Agentdan yetishmayotgan maʼlumotni soʻradim, kelishi bilan koʻrsataman.`,
    btnOther: 'Boshqa variantlarni soʻrash',
    icsCaption: 'Safarni kalendaringizga qoʻshish uchun faylni oching.',
    nudgeDraft: (dest, code) => `${dest} safari boʻyicha ${code} soʻrovi hali tasdiqlashingizni kutmoqda.`,
    agentLate: (code) => `Agent ${code} boʻyicha hali javob bermadi. Unga eslatma yubordim.`,
    nudgeOffers: (dest, code) => `${dest} (${code}) boʻyicha variantlar tanlovingizni kutmoqda. Narxlar oʻzgarishi mumkin, shuning uchun tezroq tanlagan maʼqul.`,
    checkin: (route, flight) => `Ertaga parvoz: ${route}.\nReys: ${flight}\nOnlayn roʻyxatdan oʻtish hozir ochiq boʻlishi kerak.`,
    btnTicket: 'Chiptani ochish',
    leave: (route, time) => `Reysingiz (${route}) soat ${time} da, 3 soatdan keyin. Aeroportga yoʻl olish vaqti boʻldi.`,
    welcomeBack: (dest, code) => `Safardan eson-omon qaytganingiz bilan! ${dest} safari (${code}) yopildi; uni /trips da topishingiz mumkin.`,
    mirrorGroup: 'Agent guruhi', mirrorBot: 'Bot → agent', mirrorAgent: 'Agent',
    passportHidden: '(pasport maʼlumotlari agentga yuborildi, bu yerda yashirilgan)',
    icsFlight: 'Parvoz', icsTrip: 'Safar', icsLeave: 'Aeroportga yoʻl olish vaqti',
    priceUnknown: 'narxi nomaʼlum',
    refund: { full: 'toʻliq qaytariladi', penalty: 'jarima bilan qaytariladi', none: 'qaytarilmaydi', unknown: 'koʻrsatilmagan' },
    // Mock tickets (PDF text is written with plain ASCII letters; ʻ becomes ')
    pdf: {
      ticket: 'ELEKTRON CHIPTA (TEST HUJJATI, SAFAR UCHUN YAROQSIZ)', ref: 'Bron raqami', passenger: 'Yoʻlovchi',
      voucher: 'MEHMONXONA VAUCHERI (TEST HUJJATI)', checkIn: 'Kirish', checkOut: 'Chiqish', guest: 'Mehmon',
      ticketFile: 'Chipta', voucherFile: 'Mehmonxona_vaucheri',
    },
  },
  ru: {
    langSet: 'Язык: русский 🇷🇺',
    help: 'Здравствуйте! Я ваш помощник по поездкам. Напишите или надиктуйте голосом, куда и когда вам нужно поехать — на узбекском, русском или английском. Я подготовлю заявку, поработаю с вашим турагентом и буду хранить здесь билеты и напоминания.\n\n/passport — сохранить паспортные данные (в зашифрованном виде)\n/status — статус текущей поездки\n/trips — ваши поездки\n/cancel — отменить текущую поездку\n/uz · /ru — сменить язык',
    menu: ['Новая поездка', 'Мои поездки', 'Статус'],
    route: 'Маршрут', dates: 'Даты', travelers: 'Пассажиры', flight: 'Перелёт', baggage: 'Багаж', hotel: 'Отель', budget: 'Бюджет', notes: 'Примечания',
    nights: (n) => `${n} ${plural(n, ['ночь', 'ночи', 'ночей'])}`,
    noPref: 'без предпочтений', notSet: 'не указан', notStated: 'не указано', origin: 'Ташкент',
    checkTitle: 'Проверьте заявку',
    passportNote: 'Паспорт хранится в зашифрованном виде, пока вы не выберете вариант.',
    nOptions: (n) => `${n} ${plural(n, ['вариант', 'варианта', 'вариантов'])}`,
    recommended: 'рекомендую', back: 'Обратно', cancellation: 'Отмена', why: (l) => `Почему ${l}`,
    booked: 'Забронировано', out: 'Туда', seeVoucher: 'см. ваучер', total: 'Итого',
    reminders: 'Напоминания', remCheckin: 'онлайн-регистрация', remLeave: 'выезд в аэропорт',
    noFlightTime: 'Время рейса не найдено, поэтому напоминания не установлены.',
    steps: { draft: 'Ожидает вашего подтверждения', sent: 'У агента', offers: 'Варианты готовы, выбор за вами', chosen: 'Агент бронирует', booked: 'Забронировано, документы готовы', done: 'Поездка завершена' },
    collecting: 'Собираю детали',
    agentDue: (time) => `Ответ агента ожидается до ${time}.`,
    trip: 'Поездка',
    statusWord: { collecting: 'сбор данных', draft: 'ждёт подтверждения', sent: 'у агента', offers: 'варианты готовы', chosen: 'бронируется', booked: 'забронировано', done: 'завершена', cancelled: 'отменена' },
    tooLarge: 'Файл слишком большой. Пожалуйста, отправьте файл меньше 15 МБ.',
    canRead: 'Я понимаю текст, голосовые сообщения, аудиофайлы, видеокружки, фото и PDF.',
    passedOn: 'Передал агенту.',
    readFail: 'Не получилось разобрать сообщение. Попробуйте ещё раз через минуту.',
    heard: 'Услышал',
    needMore: (list) => `Чтобы подготовить заявку, мне ещё нужно: ${list}.`,
    field: { destination: 'куда', date_from: 'дата вылета', date_to: 'дата возвращения', travelers: 'количество пассажиров' },
    btnApprove: 'Подтвердить и отправить агенту', btnEdit: 'Изменить', btnCancel: 'Отменить', btnApproveShort: 'Подтвердить и отправить',
    whereWhen: 'Куда и когда вам нужно поехать?',
    whereWhenVoice: 'Куда и когда вам нужно поехать? Можно текстом или голосом.',
    noTrip: 'Сейчас активной поездки нет.',
    noTripTell: 'Сейчас активной поездки нет. Напишите, куда и когда вам нужно поехать.',
    noCancel: 'Нет поездки для отмены.',
    passportHow: 'Отправьте одним сообщением, например:\n<code>/passport AZIZBEK UBAYDULLAYEV, FA1234567, действителен до 2031-05-01</code>\nЯ сохраню его в зашифрованном виде, удалю ваше сообщение и передам агенту только после того, как вы выберете вариант.',
    passportSaved: 'Паспорт сохранён и зашифрован. Ваше сообщение я удалил из чата.',
    unknownCmd: 'Не знаю такой команды. Нажмите /help.',
    noTripsYet: 'Поездок пока нет. Напишите, куда и когда вам нужно поехать.',
    yourTrips: 'Ваши поездки',
    notAllowed: 'Нет доступа.',
    staleBtn: 'Эта кнопка устарела.',
    editWhat: 'Что изменить? Например: «перенеси на 13–16 ноября» или «добавь Бобура вторым пассажиром».',
    nothingChanged: 'Хорошо, ничего не меняю.',
    sentToAgent: (time) => `Отправил агенту. Напишу, как только придут варианты (ожидаю до ${time}).`,
    optionGone: 'Этот вариант больше недоступен.',
    noPassport: 'У меня нет ваших паспортных данных. Отправьте их через /passport или передайте агенту напрямую.',
    booking: (l) => `Готово. Агент бронирует: ${l}. Билет и ваучер появятся здесь, когда будут готовы.`,
    askedOther: 'Попросил у агента другие варианты.',
    cancelQ: (code, dest) => `Отменить поездку ${code} — ${dest}?`,
    cancelTerms: (l, terms) => `Условия отмены для «${l}»: ${terms}.`,
    btnYesCancel: 'Да, отменить', btnKeep: 'Оставить',
    cancelled: (code, told) => `Поездка ${code} отменена.${told ? ' Я сообщил агенту.' : ''}`,
    agentMsg: 'Сообщение от агента', agentWrote: 'Агент написал', fromAgent: 'От агента', file: '(файл)',
    agentUnreadable: (code) => `Агент ответил по ${code}, но я не смог разобрать ответ. Его сообщение:`,
    offersPending: (dest, n) => `По направлению ${dest} пришло ${n} ${plural(n, ['вариант', 'варианта', 'вариантов'])}. Я уточнил у агента недостающие детали и покажу варианты, как только он ответит.`,
    btnOther: 'Попросить другие варианты',
    icsCaption: 'Откройте файл, чтобы добавить поездку в календарь.',
    nudgeDraft: (dest, code) => `Заявка ${code} (${dest}) всё ещё ждёт вашего подтверждения.`,
    agentLate: (code) => `Агент ещё не ответил по ${code}. Я отправил ему напоминание.`,
    nudgeOffers: (dest, code) => `Варианты по ${dest} (${code}) ждут вашего выбора. Цены могут измениться, лучше выбрать поскорее.`,
    checkin: (route, flight) => `Завтра вылет: ${route}.\nРейс: ${flight}\nОнлайн-регистрация уже должна быть открыта.`,
    btnTicket: 'Открыть билет',
    leave: (route, time) => `Ваш рейс (${route}) в ${time}, через 3 часа. Пора выезжать в аэропорт.`,
    welcomeBack: (dest, code) => `С возвращением! Поездка ${dest} (${code}) закрыта, её можно найти в /trips.`,
    mirrorGroup: 'Группа агента', mirrorBot: 'Бот → агент', mirrorAgent: 'Агент',
    passportHidden: '(паспортные данные отправлены агенту, здесь скрыты)',
    icsFlight: 'Перелёт', icsTrip: 'Поездка', icsLeave: 'Пора выезжать в аэропорт',
    priceUnknown: 'цена неизвестна',
    refund: { full: 'полный возврат', penalty: 'возврат со штрафом', none: 'без возврата', unknown: 'не указано' },
    // The PDF's built-in font has no Cyrillic, so Russian-mode mock tickets are in English, like real e-tickets.
    pdf: {
      ticket: 'E-TICKET (TEST DOCUMENT, NOT VALID FOR TRAVEL)', ref: 'Booking ref', passenger: 'Passenger',
      voucher: 'HOTEL VOUCHER (TEST DOCUMENT)', checkIn: 'Check-in', checkOut: 'Check-out', guest: 'Guest',
      ticketFile: 'Ticket', voucherFile: 'Hotel_voucher',
    },
  },
};

export const A = {
  uz: {
    request: 'SOʻROV', route: 'Yoʻnalish', dates: 'Sanalar', travelers: 'Yoʻlovchilar', flight: 'Parvoz', baggage: 'Bagaj', hotel: 'Mehmonxona', budget: 'Byudjet', notes: 'Izoh',
    nights: (n) => `${n} kecha`, noPref: 'farqi yoʻq', notSet: 'belgilanmagan', origin: 'Toshkent',
    ask: 'Iltimos, har bir variantni alohida yozing: reyslar, bagaj normasi, mehmonxona, umumiy narx, bekor qilish shartlari.',
    baggageAsk: 'aytilmagan — har bir variantda bagaj normasini yozing',
    note: (code) => `Azizbekdan ${code} boʻyicha izoh:`, fileAttached: '(fayl biriktirilgan)',
    chose: (l, price) => `Azizbek tanladi: ${l} (${price}). Iltimos, bron qiling va chipta hamda vaucherni shu yerga yuboring.`,
    passport: (code) => `${code} uchun pasport maʼlumotlari:`,
    noPassport: (code) => `${code} uchun pasport maʼlumotlari hali yoʻq. Azizbek ularni oʻzi yuboradi.`,
    other: (code) => `Azizbek ${code} boʻyicha boshqa variantlarni soʻramoqda, soʻrov oʻsha:`,
    cancel: (code) => `Azizbek ${code} safarini bekor qildi. Iltimos, u boʻyicha qilingan bronlarni bekor qiling va shu yerda tasdiqlang.`,
    clarify: 'Rahmat. Azizbekka koʻrsatishdan oldin, iltimos, quyidagilarni qoʻshing:',
    gap: { price: 'umumiy narx', times: 'reys vaqtlari', terms: 'bekor qilish shartlari' },
    ack: 'Qabul qildim, rahmat. Azizbekka yuborildi.',
    sla: (code, time) => `Eslatma: ${code} soʻrovi ${time} dan beri variantlarni kutmoqda.`,
    unreadable: 'Bu faylni oʻqiy olmadim.',
    chatId: (id) => `Bu chat ID raqami: <code>${id}</code> — uni AGENT_CHAT_ID ga yozing.`,
    // mock agent's own lines
    mockBooked: 'Bron qilindi. Chipta va mehmonxona vaucherini yuboryapman.',
    mockCancelled: 'Bekor qilindi. Pul qaytarish tarif qoidalariga koʻra boʻladi, summani ertaga tasdiqlayman.',
    mockNoted: 'Qabul qilindi, rahmat.',
    geminiLang: 'Uzbek (Latin script)',
  },
  ru: {
    request: 'ЗАЯВКА', route: 'Маршрут', dates: 'Даты', travelers: 'Пассажиры', flight: 'Перелёт', baggage: 'Багаж', hotel: 'Отель', budget: 'Бюджет', notes: 'Примечания',
    nights: (n) => `${n} ${plural(n, ['ночь', 'ночи', 'ночей'])}`, noPref: 'без предпочтений', notSet: 'не указан', origin: 'Ташкент',
    ask: 'Пожалуйста, опишите каждый вариант отдельно: перелёты, норма багажа, отель, общая стоимость, условия отмены.',
    baggageAsk: 'не указан — укажите норму багажа в каждом варианте',
    note: (code) => `Комментарий Азизбека по ${code}:`, fileAttached: '(файл приложен)',
    chose: (l, price) => `Азизбек выбрал: ${l} (${price}). Пожалуйста, забронируйте и пришлите сюда билет и ваучер.`,
    passport: (code) => `Паспортные данные для ${code}:`,
    noPassport: (code) => `Паспортных данных для ${code} пока нет. Азизбек пришлёт их сам.`,
    other: (code) => `Азизбек просит другие варианты по ${code}, заявка та же:`,
    cancel: (code) => `Азизбек отменил поездку ${code}. Пожалуйста, отмените все брони по ней и подтвердите здесь.`,
    clarify: 'Спасибо. Прежде чем показать варианты Азизбеку, пожалуйста, уточните:',
    gap: { price: 'общая стоимость', times: 'время рейсов', terms: 'условия отмены' },
    ack: 'Получил, спасибо. Отправил Азизбеку.',
    sla: (code, time) => `Напоминание: заявка ${code} ждёт вариантов с ${time}.`,
    unreadable: 'Не смог прочитать этот файл.',
    chatId: (id) => `ID этого чата: <code>${id}</code> — впишите его в AGENT_CHAT_ID.`,
    mockBooked: 'Забронировал. Отправляю билет и ваучер на отель.',
    mockCancelled: 'Отменил. Возврат по правилам тарифа, сумму подтвержу завтра.',
    mockNoted: 'Принято, спасибо.',
    geminiLang: 'Russian',
  },
};

export const agentLang = (env) => normLang(env.AGENT_LANG);
export const AL = (env) => A[agentLang(env)];

// ======================= sections: My trips and Personal secretary =======================

Object.assign(O.uz, {
  help: 'Assalomu alaykum! Men sizning yordamchingizman. Ikki boʻlim bor:\n\n✈️ <b>Mening safarlarim</b> — turagent bilan aloqa, marshrutlar, bronlar, hujjatlar.\n🗂 <b>Shaxsiy kotib</b> — taqvim, eslatmalar, tarjimalar, xatlar.\n\nTugmalarni bosing yoki shunchaki yozing yoki ovozli xabar yuboring — oʻzbek, rus yoki ingliz tilida. Masalan:\n• «Istanbulga 12–15-noyabr, ertalabki reys»\n• «Ertaga 15:00 da Hilton’da uchrashuv»\n• «Har kuni 8 da dori ichishni eslat»\n• «Bu matnni rus tiliga tarjima qil: …»\n• «Elchixonaga viza boʻyicha xat yoz»\n\n/today — bugungi rejalar · /reminders — eslatmalar\n/passport — pasport (shifrlangan) · /uz · /ru — til',
  kbTrips: '✈️ Mening safarlarim', kbSec: '🗂 Shaxsiy kotib',
  tripsTitle: '✈️ <b>Mening safarlarim</b>',
  tripsHint: 'Yangi safar uchun qayerga va qachon borishingizni yozing yoki ovozli xabar yuboring.',
  btnNewTrip: '➕ Yangi safar', btnAllTrips: '📋 Barcha safarlar', btnCurrentTrip: '🔎 Joriy safar',
  btnWriteAgent: '💬 Agentga yozish', btnOptions: '📋 Variantlarni koʻrish', btnDocs: (n) => `📎 Hujjatlar (${n})`,
  btnTripIcs: '📅 Kalendar fayli', btnFlightTime: '🕒 Reys vaqtini kiritish', btnCancelTrip: '❌ Safarni bekor qilish',
  statusLabel: 'Holat', bookingTitle: 'Bron',
  noDocs: 'Bu safar uchun hujjatlar hali yoʻq.',
  agentAsk: 'Agentga nima deb yozay? Matn yoki ovozli xabar yuboring.',
  flightTimeAsk: 'Reys qachon uchadi? Masalan: «12-noyabr 07:40».',
  flightTimeSet: 'Reys vaqti saqlandi.',
  flightTimeBad: 'Sana va vaqtni tushunmadim. Masalan: «12-noyabr 07:40».',
  noFlightTime: 'Reys vaqti topilmadi, shuning uchun eslatmalar qoʻyilmadi. «🕒 Reys vaqtini kiritish» tugmasi orqali qoʻshishingiz mumkin.',

  secTitle: '🗂 <b>Shaxsiy kotib</b>',
  secHint: 'Tugmani bosing yoki oddiy soʻz bilan yozing, masalan:\n• «Ertaga 15:00 da Hilton’da investorlar bilan uchrashuv»\n• «Har kuni ertalab 8 da dori ichishni eslat»\n• «Ushbu matnni rus tiliga tarjima qil: …» yoki hujjat rasmini yuboring\n• «Germaniya elchixonasiga viza boʻyicha xat yoz»',
  btnToday: '📅 Bugun', btnTomorrow: '📅 Ertaga', btnWeek: '📆 Hafta', btnReminders: '⏰ Eslatmalar',
  btnTranslate: '🌐 Tarjima', btnLetter: '✉️ Xat yozish', btnCalLink: '📲 Telefon kalendariga ulash',
  today: 'Bugun', tomorrow: 'Ertaga',
  agendaEmpty: 'Bu kunlarga rejalar yoʻq.',
  allDay: 'kun boʻyi', flightWord: 'Reys', tripWord: 'Safar',
  eventAdded: '✅ <b>Taqvimga qoʻshildi</b>',
  remindBefore: (m) => `⏰ ${m} daqiqa oldin eslataman.`,
  conflict: (list) => `⚠️ Shu vaqtda boshqa reja bor: ${list}`,
  btnDelete: '🗑 Oʻchirish', btnIcs: '📎 .ics fayl',
  deleted: 'Oʻchirildi.',
  eventHeadsUp: (m, title) => `📅 <b>${m} daqiqadan keyin:</b> ${title}`,
  reminderSet: '⏰ <b>Eslatma qoʻyildi</b>',
  repeatWord: { daily: 'har kuni', weekdays: 'ish kunlari', weekly: 'har hafta', monthly: 'har oy' },
  reminderPast: 'Bu vaqt oʻtib ketgan. Qaysi vaqtga qoʻyay?',
  reminderFire: '⏰ <b>Eslatma</b>',
  btnDone: '✅ Bajarildi', btnStop: '⏹ Takrorlashni toʻxtatish', btnSnooze15: '⏰ +15 daqiqa', btnSnooze60: '⏰ +1 soat',
  snoozed: (time) => `Yaxshi, ${time} da yana eslataman.`,
  doneOk: 'Yaxshi ✅', stopped: 'Takrorlash toʻxtatildi.',
  remindersTitle: '⏰ <b>Eslatmalar</b>',
  remindersEmpty: 'Faol eslatmalar yoʻq. Masalan, yozing: «Ertaga 9 da Boburga qoʻngʻiroq qilishni eslat».',
  translateChoose: 'Qaysi tilga tarjima qilay?', btnAuto: '🔄 Avtomatik',
  translateMode: (target) => `🌐 <b>Tarjima rejimi</b>${target ? ` (→ ${target.toUpperCase()})` : ''}\nMatn, ovozli xabar, rasm yoki PDF yuboring — tarjima qilaman.\nChiqish: pastdagi menyu tugmasi yoki /menu.`,
  translationTitle: (src, tgt) => `🌐 <b>${src} → ${tgt}</b>`,
  nothingToTranslate: 'Tarjima qilinadigan matn yoki faylni yuboring.',
  letterAsk: 'Kimga va nima haqida xat yozay? Masalan: «Germaniya elchixonasiga viza koʻrib chiqishni tezlashtirish haqida rasmiy xat».',
  btnRevise: '✏️ Oʻzgartirish', btnLetterTranslate: '🌐 Boshqa tilga',
  reviseAsk: 'Nimani oʻzgartiray? Masalan: «qisqaroq qil», «rasmiyroq», «sanani 15-noyabr deb yoz».',
  letterLangAsk: 'Qaysi tilga oʻgiray?', letterGone: 'Bu xat topilmadi.',
  writing: '✍️ Yozyapman…',
  calLink: (url) => `📲 <b>Telefon kalendariga ulash</b>\nBu havolani bir marta qoʻshsangiz, taqvimdagi uchrashuvlar va safarlar telefoningiz kalendarida oʻzi paydo boʻladi.\n\n<b>iPhone:</b> Sozlamalar → Kalendar → Hisoblar → Hisob qoʻshish → Boshqa → Obuna kalendari → havolani qoʻying.\n<b>Google Calendar</b> (kompyuterda): Boshqa kalendarlar → «+» → URL orqali → havolani qoʻying.\n\n<code>${url}</code>\n\nBu havolani hech kimga bermang.`,
  briefTitle: '☀️ <b>Xayrli tong!</b> Bugungi rejalaringiz:',
  chatFallback: 'Tushunmadim. Safar, uchrashuv, eslatma, tarjima yoki xat haqida yozing.',
  btnMenu: 'Menyu',
});

Object.assign(O.ru, {
  help: 'Здравствуйте! Я ваш помощник. Есть два раздела:\n\n✈️ <b>Мои поездки</b> — связь с турагентом, маршруты, брони, документы.\n🗂 <b>Личный секретарь</b> — календарь, напоминания, переводы, письма.\n\nНажимайте кнопки или просто пишите и отправляйте голосовые — на узбекском, русском или английском. Например:\n• «Стамбул, 12–15 ноября, утренний рейс»\n• «Завтра в 15:00 встреча в Hilton»\n• «Напоминай каждый день в 8 выпить лекарство»\n• «Переведи на узбекский: …»\n• «Напиши письмо в посольство насчёт визы»\n\n/today — планы на сегодня · /reminders — напоминания\n/passport — паспорт (зашифрован) · /uz · /ru — язык',
  kbTrips: '✈️ Мои поездки', kbSec: '🗂 Личный секретарь',
  tripsTitle: '✈️ <b>Мои поездки</b>',
  tripsHint: 'Для новой поездки напишите или скажите голосом, куда и когда вам нужно.',
  btnNewTrip: '➕ Новая поездка', btnAllTrips: '📋 Все поездки', btnCurrentTrip: '🔎 Текущая поездка',
  btnWriteAgent: '💬 Написать агенту', btnOptions: '📋 Посмотреть варианты', btnDocs: (n) => `📎 Документы (${n})`,
  btnTripIcs: '📅 Файл для календаря', btnFlightTime: '🕒 Указать время рейса', btnCancelTrip: '❌ Отменить поездку',
  statusLabel: 'Статус', bookingTitle: 'Бронь',
  noDocs: 'Документов по этой поездке пока нет.',
  agentAsk: 'Что передать агенту? Отправьте текст или голосовое.',
  flightTimeAsk: 'Когда вылет? Например: «12 ноября 07:40».',
  flightTimeSet: 'Время рейса сохранено.',
  flightTimeBad: 'Не понял дату и время. Например: «12 ноября 07:40».',
  noFlightTime: 'Время рейса не найдено, поэтому напоминания не установлены. Его можно указать кнопкой «🕒 Указать время рейса».',

  secTitle: '🗂 <b>Личный секретарь</b>',
  secHint: 'Нажмите кнопку или напишите своими словами, например:\n• «Завтра в 15:00 встреча с инвесторами в Hilton»\n• «Напоминай каждый день в 8 утра выпить лекарство»\n• «Переведи на узбекский: …» или пришлите фото документа\n• «Напиши письмо в посольство Германии насчёт визы»',
  btnToday: '📅 Сегодня', btnTomorrow: '📅 Завтра', btnWeek: '📆 Неделя', btnReminders: '⏰ Напоминания',
  btnTranslate: '🌐 Перевод', btnLetter: '✉️ Написать письмо', btnCalLink: '📲 Подключить к календарю телефона',
  today: 'Сегодня', tomorrow: 'Завтра',
  agendaEmpty: 'На эти дни планов нет.',
  allDay: 'весь день', flightWord: 'Рейс', tripWord: 'Поездка',
  eventAdded: '✅ <b>Добавил в календарь</b>',
  remindBefore: (m) => `⏰ Напомню за ${m} мин.`,
  conflict: (list) => `⚠️ На это время уже есть: ${list}`,
  btnDelete: '🗑 Удалить', btnIcs: '📎 Файл .ics',
  deleted: 'Удалено.',
  eventHeadsUp: (m, title) => `📅 <b>Через ${m} мин:</b> ${title}`,
  reminderSet: '⏰ <b>Напоминание установлено</b>',
  repeatWord: { daily: 'каждый день', weekdays: 'по будням', weekly: 'каждую неделю', monthly: 'каждый месяц' },
  reminderPast: 'Это время уже прошло. На когда поставить?',
  reminderFire: '⏰ <b>Напоминание</b>',
  btnDone: '✅ Сделано', btnStop: '⏹ Больше не повторять', btnSnooze15: '⏰ +15 мин', btnSnooze60: '⏰ +1 час',
  snoozed: (time) => `Хорошо, напомню ещё раз в ${time}.`,
  doneOk: 'Отлично ✅', stopped: 'Повтор отключён.',
  remindersTitle: '⏰ <b>Напоминания</b>',
  remindersEmpty: 'Активных напоминаний нет. Например, напишите: «Напомни завтра в 9 позвонить Бобуру».',
  translateChoose: 'На какой язык перевести?', btnAuto: '🔄 Автоматически',
  translateMode: (target) => `🌐 <b>Режим перевода</b>${target ? ` (→ ${target.toUpperCase()})` : ''}\nОтправьте текст, голосовое, фото или PDF — переведу.\nВыход: кнопка меню внизу или /menu.`,
  translationTitle: (src, tgt) => `🌐 <b>${src} → ${tgt}</b>`,
  nothingToTranslate: 'Отправьте текст или файл для перевода.',
  letterAsk: 'Кому и о чём написать? Например: «официальное письмо в посольство Германии с просьбой ускорить рассмотрение визы».',
  btnRevise: '✏️ Изменить', btnLetterTranslate: '🌐 На другой язык',
  reviseAsk: 'Что изменить? Например: «короче», «официальнее», «укажи дату 15 ноября».',
  letterLangAsk: 'На какой язык перевести?', letterGone: 'Письмо не найдено.',
  writing: '✍️ Пишу…',
  calLink: (url) => `📲 <b>Подключить к календарю телефона</b>\nДобавьте эту ссылку один раз — встречи и поездки будут сами появляться в календаре телефона.\n\n<b>iPhone:</b> Настройки → Календарь → Учётные записи → Добавить → Другое → Подписной календарь → вставьте ссылку.\n<b>Google Календарь</b> (на компьютере): Другие календари → «+» → Добавить по URL → вставьте ссылку.\n\n<code>${url}</code>\n\nНикому не передавайте эту ссылку.`,
  briefTitle: '☀️ <b>Доброе утро!</b> Ваши планы на сегодня:',
  chatFallback: 'Не понял. Напишите про поездку, встречу, напоминание, перевод или письмо.',
  btnMenu: 'Меню',
});

COMMANDS.uz.splice(0, COMMANDS.uz.length,
  { command: 'menu', description: 'Asosiy menyu' },
  { command: 'today', description: 'Bugungi rejalar' },
  { command: 'reminders', description: 'Eslatmalar' },
  { command: 'trips', description: 'Safarlarim' },
  { command: 'status', description: 'Joriy safar holati' },
  { command: 'passport', description: 'Pasport maʼlumotlarini saqlash (shifrlangan)' },
  { command: 'cancel', description: 'Joriy safarni bekor qilish' },
  { command: 'help', description: 'Yordam' },
  { command: 'uz', description: '🇺🇿 Oʻzbek tili' },
  { command: 'ru', description: '🇷🇺 Русский язык' });
COMMANDS.ru.splice(0, COMMANDS.ru.length,
  { command: 'menu', description: 'Главное меню' },
  { command: 'today', description: 'Планы на сегодня' },
  { command: 'reminders', description: 'Напоминания' },
  { command: 'trips', description: 'Мои поездки' },
  { command: 'status', description: 'Статус текущей поездки' },
  { command: 'passport', description: 'Сохранить паспорт (в зашифрованном виде)' },
  { command: 'cancel', description: 'Отменить текущую поездку' },
  { command: 'help', description: 'Помощь' },
  { command: 'uz', description: '🇺🇿 Oʻzbek tili' },
  { command: 'ru', description: '🇷🇺 Русский язык' });

// Labels of the bottom keyboard in every language, to recognise a tap whatever language is set.
export const KB_TRIPS = new Set(LANGS.map((l) => O[l].kbTrips));
export const KB_SEC = new Set(LANGS.map((l) => O[l].kbSec));

// Trip request: what the bot asks for itself (not Gemini), from what is really missing.
O.uz.askMissing = (list) => `Aniqlashtirib bering: ${list}.`;
O.ru.askMissing = (list) => `Уточните, пожалуйста: ${list}.`;
O.uz.optionalHint = 'Xohlasangiz, reys vaqti va mehmonxona boʻyicha istaklaringizni ham yozing.';
O.ru.optionalHint = 'Если хотите, напишите и пожелания по времени рейса и отелю.';
O.uz.baggageByFare = 'tarifga koʻra (agent har bir variantda yozadi)';
O.ru.baggageByFare = 'по тарифу (агент укажет в каждом варианте)';

// One-way and flexible dates (card and agent request)
Object.assign(O.uz, { oneWay: 'bir tomonga', flexible: 'moslashuvchan' });
Object.assign(O.ru, { oneWay: 'в одну сторону', flexible: 'гибко' });
Object.assign(A.uz, { oneWay: 'bir tomonga', flexible: 'sanalar moslashuvchan' });
Object.assign(A.ru, { oneWay: 'в одну сторону', flexible: 'даты гибкие' });

// Optional questions (he can send without answering) and the agent's note for flexible dates
O.uz.askOptional = (list) => `Agar bilsangiz, yozing: ${list}. Bilmasangiz, shunday yuboravering — agent aniqlashtiradi.`;
O.ru.askOptional = (list) => `Если знаете, напишите: ${list}. Если нет — отправляйте так, агент уточнит.`;
O.uz.field.date_from = 'qachon (taxminan boʻlsa ham)';
O.ru.field.date_from = 'когда (хотя бы примерно)';
A.uz.flexAsk = 'Sanalar moslashuvchan: eng arzon sanalarni taklif qiling.';
A.ru.flexAsk = 'Даты гибкие: предложите самые дешёвые даты.';

// Search mode (no travel agent): the bot finds flights and hotels itself
Object.assign(O.uz, {
  searching: '🔎 Reyslar va mehmonxonalarni qidiryapman. Odatda 1–2 daqiqa.',
  searchingAgain: '🔎 Boshqa variantlarni qidiryapman…',
  searchFailed: 'Hozir variantlarni topa olmadim. Birozdan keyin qayta urinib koʻring.',
  btnRetrySearch: '🔁 Qayta qidirish',
  pricesApprox: 'ℹ️ Narxlar taxminiy. Aniq narx va boʻsh joylar — havolalarda.',
  linkAirline: 'Aviakompaniya', linkHotel: 'Mehmonxona',
  chosenSearch: (l) => `✅ Tanlandi: <b>${l}</b>.`,
  bookHint: 'Quyidagi havolalar orqali bron qiling. Bron qilgach «Bron qildim» tugmasini bosing yoki chiptani shu yerga yuboring — eslatmalar va taqvimni qoʻyaman.',
  btnApproveSearch: 'Tasdiqlash va qidirish',
  btnBooked: '✅ Bron qildim', btnPickOther: '↩️ Boshqa variant tanlash', btnBookingLinks: '🔗 Bron havolalari',
  docSaved: (code) => `📎 Hujjat saqlandi (${code}).`,
  noAgentNote: 'Turagent ulanmagan. Bronni oʻzgartirish uchun bron qilgan saytingizdan foydalaning.',
  stepsSearch: { sent: 'Variantlar qidirilmoqda', chosen: 'Bron qilishingiz kutilmoqda' },
  statusWordSearch: { sent: 'qidirilmoqda', chosen: 'bron kutilmoqda' },
});
Object.assign(O.ru, {
  searching: '🔎 Ищу рейсы и отели. Обычно 1–2 минуты.',
  searchingAgain: '🔎 Ищу другие варианты…',
  searchFailed: 'Сейчас не получилось найти варианты. Попробуйте ещё раз чуть позже.',
  btnRetrySearch: '🔁 Искать снова',
  pricesApprox: 'ℹ️ Цены примерные. Точная цена и наличие мест — по ссылкам.',
  linkAirline: 'Авиакомпания', linkHotel: 'Отель',
  chosenSearch: (l) => `✅ Выбрано: <b>${l}</b>.`,
  bookHint: 'Забронируйте по ссылкам ниже. После брони нажмите «Я забронировал» или пришлите билет сюда — поставлю напоминания и добавлю в календарь.',
  btnApproveSearch: 'Подтвердить и искать',
  btnBooked: '✅ Я забронировал', btnPickOther: '↩️ Выбрать другой вариант', btnBookingLinks: '🔗 Ссылки для брони',
  docSaved: (code) => `📎 Документ сохранён (${code}).`,
  noAgentNote: 'Турагент не подключён. Чтобы изменить бронь, используйте сайт, где бронировали.',
  stepsSearch: { sent: 'Ищу варианты', chosen: 'Ждёт вашей брони' },
  statusWordSearch: { sent: 'поиск', chosen: 'ждёт брони' },
});

// Search mode (no agent): texts that would otherwise mention the agent
O.uz.search = {
  help: O.uz.help.replace('turagent bilan aloqa, marshrutlar, bronlar, hujjatlar', 'reys va mehmonxona qidirish, marshrutlar, bronlar, hujjatlar'),
  passportHow: 'Bitta xabarda yuboring, masalan:\n<code>/passport AZIZBEK UBAYDULLAYEV, FA1234567, 2031-05-01 gacha amal qiladi</code>\nMen uni shifrlab saqlayman va xabaringizni chatdan oʻchiraman.',
  baggageByFare: 'tarifga koʻra (har bir variantda koʻrsatiladi)',
  askOptional: (list) => `Agar bilsangiz, yozing: ${list}. Bilmasangiz, shunday yuboravering.`,
};
O.ru.search = {
  help: O.ru.help.replace('связь с турагентом, маршруты, брони, документы', 'поиск рейсов и отелей, маршруты, брони, документы'),
  passportHow: 'Отправьте одним сообщением, например:\n<code>/passport AZIZBEK UBAYDULLAYEV, FA1234567, действителен до 2031-05-01</code>\nЯ сохраню его в зашифрованном виде и удалю ваше сообщение из чата.',
  baggageByFare: 'по тарифу (указан в каждом варианте)',
  askOptional: (list) => `Если знаете, напишите: ${list}. Если нет — отправляйте так.`,
};

// Prices from Aviasales (Travelpayouts token set)
O.uz.pricesAviasales = 'ℹ️ Reys narxlari Aviasales’dan (soʻnggi qidiruvlar asosida). Aniq narx — havolada.';
O.ru.pricesAviasales = 'ℹ️ Цены на рейсы — с Aviasales (по недавним поискам). Точная цена — по ссылке.';

// Tickets
Object.assign(O.uz, {
  ticketRead: (flight, when) => `✈️ Chiptadan oʻqidim: <b>${flight}</b>, ${when}. Eslatmalar shu vaqtga qoʻyiladi.`,
  ticketNoTime: 'Undan reys vaqtini oʻqiy olmadim — vaqtni tugma orqali kiriting.',
  ticketNoTrip: 'Bu hujjat qaysi safarga tegishli ekanini tushunmadim. Chiptani aniqroq rasm yoki PDF qilib yuboring.',
  checkTimeHint: 'ℹ️ Reys vaqti qidiruvdan olindi. Chiptangizni yuborsangiz, aniq vaqtni oʻqib olaman.',
  btnChangeTime: '🕒 Vaqtni oʻzgartirish',
});
Object.assign(O.ru, {
  ticketRead: (flight, when) => `✈️ Прочитал из билета: <b>${flight}</b>, ${when}. Напоминания будут на это время.`,
  ticketNoTime: 'Не смог прочитать время рейса — укажите его кнопкой.',
  ticketNoTrip: 'Не понял, к какой поездке относится документ. Пришлите билет более чётким фото или PDF.',
  checkTimeHint: 'ℹ️ Время рейса взято из поиска. Пришлите билет — прочитаю точное время.',
  btnChangeTime: '🕒 Изменить время',
});

// Never silent
O.uz.sorryError = 'Kechirasiz, xabaringizni qayta ishlashda xatolik boʻldi. Iltimos, yana bir bor yuboring.';
O.ru.sorryError = 'Извините, при обработке сообщения произошла ошибка. Пожалуйста, отправьте его ещё раз.';
O.uz.sorryLost = 'Kechirasiz, oxirgi xabaringizga javob bera olmadim (juda uzoq davom etdi). Iltimos, yana bir bor yuboring.';
O.ru.sorryLost = 'Извините, не успел ответить на ваше последнее сообщение (обработка заняла слишком долго). Пожалуйста, отправьте его ещё раз.';

O.uz.perNight = '/kecha';
O.ru.perNight = '/ночь';

// The trip took place: stop reminders
Object.assign(O.uz, {
  btnFinishTrip: '✅ Safar yakunlandi (eslatmalarni toʻxtatish)',
  tripFinished: (code, dest) => `Yaxshi, ${dest} safari (${code}) yakunlandi — u haqida boshqa eslatmayman. Oq yoʻl!`,
});
Object.assign(O.ru, {
  btnFinishTrip: '✅ Поездка состоялась (без напоминаний)',
  tripFinished: (code, dest) => `Хорошо, поездка ${dest} (${code}) завершена — больше не напоминаю. Хорошей дороги!`,
});

// Questions unrelated to trips or his work: a fixed, polite answer (no Gemini text)
O.uz.offTopic = 'Bu savolga javob bera olmayman — men safarlar va ish yordamchisiman. Yordam bera olaman: ✈️ safar va reys qidirish, 📅 uchrashuvlar va eslatmalar, 🌐 tarjima, ✉️ xat yozish. Safarlaringiz bilan bogʻliq savollar (viza, ob-havo, valyuta va h.k.) ham boʻlsa, bemalol soʻrang.';
O.ru.offTopic = 'На этот вопрос не отвечу — я помощник по поездкам и работе. Могу помочь: ✈️ найти рейс и отель, 📅 встречи и напоминания, 🌐 перевод, ✉️ письма. Вопросы о поездках (виза, погода, валюта и т.п.) — тоже пожалуйста.';
