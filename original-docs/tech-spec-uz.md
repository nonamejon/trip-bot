# AI-yordamchi Telegram bot — Texnik topshiriq

Oct 31, 2026 · @Kuvonchbek

## 1. Loyiha maqsadi va doirasi

Azizbek uchun Telegram ichida ishlaydigan shaxsiy AI-yordamchi quriladi: u safarlarni turagent bilan birga tashkil qiladi, kundalik kotib vazifalarini bajaradi, keyinroq EAS ish vazifalariga yordam beradi. Birinchi bosqich (MVP) faqat safarlar va eslatmalarni qamraydi.

**Bot bo'limlari:**

| Bo'lim | Vazifalar | Bosqich |
| --- | --- | --- |
| Mening safarlarim | Zayavka, turagent bilan aloqa, takliflarni solishtirish, bron va hujjatlar | MVP |
| Shaxsiy kotib | Kalendar, eslatmalar, tarjima, xat qoralamalari | 2-bosqich |
| EAS | Ish vazifalari, materiallar tayyorlash, kompaniya hujjatlari bo'yicha qidiruv | 3-bosqich |

**MVP doirasiga kirmaydi:** to'g'ridan-to'g'ri aviabilet va mehmonxona bron qilish (buni turagent qiladi), onlayn to'lov, restoran va transfer xizmatlari bilan avtomatik integratsiya. Bunday so'rovlar uchun bot zayavka tayyorlab, mas'ul shaxsga yuboradi.

## 2. Rollar va huquqlar

Tizimda uchta rol bor; botga faqat ro'yxatdan o'tgan Telegram ID'lar kira oladi.

| Harakat | Azizbek (egasi) | Turagent | Admin |
| --- | --- | --- | --- |
| Zayavka yaratish va tasdiqlash | Ha | Yo'q | Yo'q |
| Tasdiqlangan zayavkani ko'rish | Ha | Ha (faqat o'ziga yuborilgan) | Ha |
| Taklif yuborish | Yo'q | Ha | Yo'q |
| Variantni tanlash | Ha | Yo'q | Yo'q |
| Hujjat (bilet, vaucher) yuklash | Ha | Ha | Ha |
| Pasport ma'lumotlarini ko'rish | Ha | Faqat rasmiylashtirish bosqichida | Yo'q |
| Foydalanuvchilar va sozlamalarni boshqarish | Yo'q | Yo'q | Ha |
| Loglarni ko'rish | Yo'q | Yo'q | Ha |

Keyingi bosqichlarda Azizbekning yordamchisi yoki assistenti uchun alohida "vakil" roli qo'shilishi mumkin: zayavka tayyorlaydi, lekin tasdiqlay olmaydi.

## 3. Asosiy jarayon

&#91;embedded content: asosiy jarayon · 9 qadam, 3 ishtirokchi\]

Bot har bir o'tishda vositachi: Azizbek va agent bir-biriga to'g'ridan-to'g'ri yozmaydi. Azizbek faqat 3-qadamda (tasdiqlash) va 7-qadamda (tanlash) qaror qabul qiladi, qolgan ishni bot va agent bajaradi.

## 4. Funksional talablar

MVP'da 9 ta funksiya bo'ladi; har biri qabul qilish mezonlari (11-bo'lim) bilan tekshiriladi.

**FT-01. Zayavka yaratish**

- Azizbek matn yoki ovozli xabar yuboradi (o'zbek yoki rus tilida).
- Ovozli xabar STT orqali matnga aylantiriladi, keyin AI uni tahlil qiladi.
- AI quyidagi maydonlarni ajratadi: yo'nalish, sanalar, qatnashchilar soni va ismlari, byudjet, bagaj, parvoz vaqti istagi, mehmonxona talablari (joylashuv, yulduz, nonushta), izoh.
- Yetishmagan majburiy maydonlar (yo'nalish, sana, qatnashchilar) bo'yicha bot bitta xabarda aniqlovchi savol beradi.
- Doimiy afzalliklar (masalan, "oyna yonidagi o'rindiq", "biznes-klass") profilda saqlanadi va har bir zayavkaga avtomatik qo'shiladi.

**FT-02. Zayavkani tasdiqlash**

- Bot zayavkani karta ko'rinishida ko'rsatadi: barcha maydonlar, tugmalar "Tasdiqlash", "Tahrirlash", "Bekor qilish".
- Azizbek tasdiqlamaguncha hech narsa agentga yuborilmaydi.

**FT-03. Agentga yuborish**

- Tasdiqlangan zayavka turagentning Telegram guruhiga belgilangan shablonda yuboriladi (6-bo'lim).
- Pasport ma'lumotlari bu bosqichda yuborilmaydi.
- Azizbekka "Agentga yuborildi" statusi keladi.

**FT-04. Takliflarni qabul qilish**

- Agent javobni shablon bo'yicha yoki erkin matn, PDF, skrinshot ko'rinishida yuboradi.
- AI har bir taklifdan ajratadi: aviakompaniya, reys, uchish va qo'nish vaqti, ulanishlar, bagaj, mehmonxona, joylashuv, xona turi, to'liq narx, qaytarish va bekor qilish shartlari.
- AI aniqlay olmagan maydon "aniqlanmadi" deb belgilanadi va agentdan aniqlashtirish so'raladi.

**FT-05. Takliflarni solishtirish**

- Bot 2–3 variantni bitta solishtirish kartasida ko'rsatadi: to'liq narx, reys qulayligi, mehmonxona joylashuvi (uchrashuv manzilidan masofa), qaytarish shartlari.
- AI qisqa tavsiya beradi va sababini bir qatorda yozadi.
- Har bir variant ostida "Tanlash" tugmasi, umumiy "Boshqa variant so'rash" tugmasi.

**FT-06. Variantni tanlash va rasmiylashtirish**

- Tanlangan variant agentga yuboriladi.
- Shu bosqichda bot pasport ma'lumotlarini faqat agentga, himoyalangan shaklda uzatadi (7-bo'lim).
- Agent bilet va vaucherlarni guruhga yuklaydi; bot ularni safarga biriktiradi.

**FT-07. Safar kartasi va hujjatlar**

- Har bir safar uchun bitta karta: marshrut, reyslar, mehmonxona manzili va xaritasi, bilet va vaucher fayllari, agent kontakti.
- "Mening safarlarim" bo'limida joriy, kelgusi va o'tgan safarlar ro'yxati.

**FT-08. Kalendar va eslatmalar**

- Reys va mehmonxona Google Calendar'ga avtomatik qo'shiladi.
- Eslatmalar: uchishdan 24 soat oldin (onlayn ro'yxatdan o'tish), 3 soat oldin (aeroportga chiqish), mehmonxonaga kirish kuni.

**FT-09. O'zgartirish va bekor qilish**

- Azizbek "Sanani o'zgartirish" yoki "Bekor qilish" so'raydi; bot jarima va qaytarish shartlarini ko'rsatadi, tasdiqdan keyin agentga yuboradi.

## 5. Safar statuslari va o'tish qoidalari

&#91;embedded content: safar statuslari · 7 asosiy, 1 bekor\]

Belgilangan ikki status (Qoralama va Takliflar keldi) Azizbekning harakatisiz oldinga siljimaydi; bot ular bo'yicha 2 soatdan keyin bir marta eslatadi.

- Har bir o'tish `status_history` jadvaliga kim va qachon bilan yoziladi.
- Tahrirlash Qoralama va Tasdiqlandi statuslarida erkin; agentga yuborilgandan keyingi o'zgarish yangi versiya sifatida agentga qayta yuboriladi.
- Agentga yuborildi statusida SLA muddati o'tsa, agentga avtomatik eslatma ketadi.
- Rasmiylashtirildi statusida bekor qilishda bot avval jarima va qaytarish shartlarini ko'rsatadi va qayta tasdiq so'raydi.
- Yakunlandi statusi qaytish reysi qo'ngan kunning ertasiga avtomatik qo'yiladi.

## 6. Turagent bilan ishlash tartibi

Agent bilan barcha aloqa bitta yopiq Telegram guruhida bo'ladi: unda bot, turagent va admin bor. Har bir safar guruhda alohida mavzu (topic) sifatida ochiladi, shunda zayavkalar aralashib ketmaydi.

**Botdan agentga zayavka shabloni:**

```markdown
ZAYAVKA #T-0042
Yo'nalish: Toshkent → Istanbul
Sanalar: 12.11 – 15.11 (3 kecha)
Qatnashchilar: 1 kishi
Parvoz: ertalabki reys, to'g'ridan-to'g'ri
Bagaj: 1 x 23 kg
Mehmonxona: 4–5*, uchrashuv manzili yonida (Levent), nonushta bilan
Byudjet: belgilanmagan
Javob muddati: 4 soat ichida
```

**Agentdan javob shabloni (har bir variant uchun):**

```markdown
VARIANT 1
Reys: TK 371, 12.11 07:40 → 10:55 / TK 370, 15.11 19:20 → 01:30
Bagaj: 23 kg
Mehmonxona: nomi, yulduz, manzil
Xona: Standard, nonushta bilan
To'liq narx: ... USD
Qaytarish: shartlari
```

Shablondagi raqamlar namuna sifatida berilgan.

**Kelishilgan qoidalar:**

- Javob muddati: ish vaqtida 4 soat, shoshilinch zayavka uchun 1 soat (aniq SLA agent bilan kelishiladi).
- Muddat o'tsa, bot agentga avtomatik eslatma yuboradi va Azizbekka statusni bildiradi.
- Agent shablonga rioya qilmasa ham bot erkin matn, PDF va skrinshotni qabul qiladi, lekin aniqlanmagan maydonlarni so'raydi.
- Agent bilet va vaucherlarni faqat shu guruhga yuklaydi.

## 7. Nofunksional talablar

Asosiy talab xavfsizlik: pasport ma'lumotlari shifrlanadi va faqat rasmiylashtirish bosqichida, faqat agentga ochiladi.

**Xavfsizlik**

- Botga kirish faqat oq ro'yxatdagi Telegram ID'lar uchun; boshqa foydalanuvchilarga bot javob bermaydi.
- Pasport va shaxsiy ma'lumotlar bazada AES-256 bilan shifrlanadi, kalit alohida saqlanadi (serverdagi kod ichida emas).
- Pasport ma'lumotlari LLM'ga yuborilmaydi; AI faqat safar parametrlari bilan ishlaydi.
- Barcha tokenlar (Telegram, Claude API, STT, Google) `.env` yoki secret manager'da saqlanadi.
- Server bilan aloqa faqat HTTPS (webhook), bazaga tashqi kirish yopiq.
- Har bir harakat audit logga yoziladi: kim, qachon, nima qildi.
- Kunlik zaxira nusxa (backup), shifrlangan holda.

**Tillar**

- Interfeys: o'zbek (lotin) va rus tillari, foydalanuvchi profilida tanlanadi.
- Ovozli va matnli kiritish: o'zbek va rus tillari.

**Tezlik va ishonchlilik**

- Oddiy xabarga javob: 3 soniyagacha; AI tahlili bilan: 10 soniyagacha.
- Ovozli xabarni (1 daqiqagacha) matnga aylantirish: 15 soniyagacha.
- Ish vaqti: 99% (oyiga 7 soatdan ko'p bo'lmagan to'xtash).
- Tashqi API (Claude, STT) ishlamasa, bot buni ochiq aytadi va zayavkani qoralama sifatida saqlaydi.

**Monitoring**

- Xatolar bo'yicha adminga Telegram orqali avtomatik xabar.
- API xarajatlari kunlik hisobga olinadi va limitdan oshsa ogohlantiriladi.

## 8. Arxitektura va texnologiyalar

&#91;embedded content: arxitektura · Telegram, Go backend, tashqi API, saqlash\]

Telegram faqat interfeys: barcha mantiq, ma'lumot va tashqi API chaqiruvlari bitta Go backend ichida, shuning uchun pasport ma'lumotlari qayerga ketishini to'liq nazorat qilamiz.

| Qatlam | Texnologiya |
| --- | --- |
| Backend | Go, Telegram Bot API (webhook), Docker |
| Ma'lumotlar bazasi | PostgreSQL (pgcrypto bilan shifrlash) |
| AI | Claude API: zayavka va takliflar tahlili, solishtirish |
| Ovoz | STT modeli (o'zbek va rus tillari) |
| Kalendar | Google Calendar API |
| Fayllar | Telegram `file_id` + S3 yoki MinIO zaxira |
| Server | VPS, Ubuntu, 2 CPU, 4 GB RAM, kunlik backup |

## 9. Ma'lumotlar bazasi sxemasi

MVP uchun PostgreSQL'da 9 ta asosiy jadval yetarli; markaziy jadval `trips`, qolganlari unga bog'lanadi.

| Jadval | Asosiy maydonlar | Vazifasi |
| --- | --- | --- |
| `users` | id, telegram\_id, role, full\_name, language, is\_active | Foydalanuvchilar va rollar |
| `travelers` | id, user\_id, full\_name, passport\_enc, passport\_expiry, preferences (jsonb) | Safarchilar; pasport shifrlangan |
| `trips` | id, code (T-0042), owner\_id, status, destination, date\_from, date\_to, budget, notes, agent\_topic\_id | Safar va uning statusi |
| `trip_requests` | id, trip\_id, raw\_text, voice\_file\_id, parsed (jsonb), version, approved\_at | Zayavka matni va AI tahlili |
| `offers` | id, trip\_id, agent\_id, flight (jsonb), hotel (jsonb), total\_price, currency, cancel\_terms, raw\_source, is\_selected | Agent takliflari |
| `documents` | id, trip\_id, type (ticket, voucher, other), file\_id, uploaded\_by, created\_at | Bilet va vaucherlar |
| `reminders` | id, trip\_id, remind\_at, type, sent\_at | Eslatmalar navbati |
| `status_history` | id, trip\_id, from\_status, to\_status, actor\_id, created\_at | Statuslar tarixi |
| `audit_log` | id, actor\_id, action, entity, entity\_id, created\_at | Barcha harakatlar logi |

Fayllarning o'zi Telegram'da qoladi (`file_id`), zaxira nusxasi esa obyekt omborida (S3 yoki MinIO) shifrlangan holda saqlanadi.

## 10. Bosqichlar va muddatlar

MVP taxminan 7 haftada ishga tushadi; har bir keyingi bosqich oldingisi real foydalanishda sinalgandan keyin boshlanadi. Muddatlar bitta backend dasturchi va qisman dizayner uchun taxminiy baho.

| Bosqich | Tarkibi | Muddat (taxminiy) | Natija |
| --- | --- | --- | --- |
| 0. Tayyorgarlik | Agent bilan SLA va shablonlarni kelishish, server, tokenlar, Telegram guruh | 1 hafta | Kelishilgan jarayon |
| 1. MVP: Safarlar | FT-01 – FT-09, xavfsizlik, admin buyruqlari | 6 hafta | Azizbek birinchi real safarni bot orqali tashkil qiladi |
| 2. Shaxsiy kotib | Kalendar boshqaruvi, eslatmalar, tarjima, xat qoralamalari, restoran va transfer so'rovlari | 4 hafta | Kundalik vazifalar bot orqali |
| 3. EAS | Ish vazifalari, hujjatlar bo'yicha qidiruv | 6 hafta | Xavfsizlik bo'yicha kelishuvdan keyin |

MVP ichidagi tartib: 1–2-hafta zayavka va tasdiqlash; 3–4-hafta agent guruhi va takliflar tahlili; 5-hafta solishtirish, hujjatlar, kalendar; 6-hafta test, xavfsizlik tekshiruvi va ishga tushirish.

3-bosqichdan oldin hal qilinadi: EAS hujjatlari tashqi LLM API'ga yuborilishi mumkinmi yoki lokal model kerakmi.

## 11. Qabul qilish mezonlari

MVP quyidagi barcha bandlar bajarilganda va bitta real safar bot orqali to'liq tashkil qilinganda qabul qilinadi.

- [ ] Ovozli xabardan (o'zbek va rus) zayavka to'g'ri tuziladi: 10 ta sinov xabaridan kamida 9 tasida majburiy maydonlar to'g'ri ajratiladi.
- [ ] Majburiy maydon yetishmasa, bot bitta xabarda aniqlovchi savol beradi.
- [ ] Tasdiqlanmagan zayavka agentga hech qachon yuborilmaydi.
- [ ] Zayavka agent guruhida alohida mavzu sifatida, shablon bo'yicha ochiladi.
- [ ] Agentning erkin matn, PDF va skrinshot javoblari tahlil qilinadi; aniqlanmagan maydon belgilanadi.
- [ ] Solishtirish kartasi 2–3 variantni to'liq narx, reys, mehmonxona va qaytarish shartlari bo'yicha ko'rsatadi.
- [ ] SLA muddati o'tsa, agentga avtomatik eslatma ketadi.
- [ ] Bilet va vaucherlar safar kartasiga biriktiriladi va "Mening safarlarim"da ko'rinadi.
- [ ] Reys Google Calendar'ga qo'shiladi; 24 soat va 3 soat oldingi eslatmalar keladi.
- [ ] Pasport ma'lumotlari bazada shifrlangan, LLM'ga yuborilmaydi, agentga faqat rasmiylashtirish bosqichida ochiladi.
- [ ] Oq ro'yxatda bo'lmagan Telegram foydalanuvchisiga bot javob bermaydi.
- [ ] Barcha harakatlar audit logda qayd etiladi.
