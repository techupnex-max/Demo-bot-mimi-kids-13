JavaScript;
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

// ================= КОНФИГУРАЦИЯ (МЕНЯТЬ ЗДЕСЬ) =================
const CONFIG = {
  BOT_TOKEN: "9279754449:AAElcvl4Kf2b3SrqLMLSeAYA8cHNp2ifHhQ", // 1. Токен из @BotFather
  ADMIN_CHAT_ID: "1850634266", // 2. Твой цифровой ID в Telegram (узнать через /my_id в боте)
  PICKUP_ADDRESS:
    "г. Москва, ул. Детская, д. 13, ТЦ «Солнечный», 2 этаж, пав. 13 (ежедневно 10:00–20:00)", // 3. Адрес магазина
};

// Запуск бота в режиме Long Polling (не требует вебхуков и ngrok)
const bot = new TelegramBot(CONFIG.BOT_TOKEN, { polling: true });

// Хранилище активных диалогов
const sessions = new Map();

// Регулярные выражения для валидации
const REGEX = {
  NAME: /^[А-Яа-яЁёA-Za-z\s\-]{2,40}$/,
  PHONE:
    /^(\+7|7|8)?[\s\-]??[489][0-9]2?[\s\-]?[0-9]{3}[\s\-]?[0-9]{2}[\s\-]?[0-9]{2}$/,
  ADDRESS: /^(?=.*\d).{10,250}$/,
};

// ================= РЕЗЕРВНОЕ СОХРАНЕНИЕ В EXCEL/CSV =================
function saveOrderToCSV(orderData) {
  const filePath = path.join(__dirname, "orders_backup.csv");
  const header =
    "ID Заказа;Дата и время;Имя;Телефон;Username;Заказ;Способ получения;Адрес;Комментарий\n";

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "\uFEFF" + header, "utf8"); // BOM для корректной кириллицы в Excel
  }

  const clean = (str) =>
    String(str || "")
      .replace(/;/g, ",")
      .replace(/\n/g, " ");
  const row =
    [
      orderData.orderId,
      orderData.datetime,
      clean(orderData.name),
      clean(orderData.phone),
      clean(orderData.username),
      clean(orderData.items),
      clean(orderData.deliveryMethod),
      clean(orderData.address),
      clean(orderData.comment),
    ].join(";") + "\n";

  fs.appendFileSync(filePath, row, "utf8");
}

// ================= ТАЙМЕР НАПОМИНАНИЯ (15 МИНУТ) =================
function resetInactivityTimer(chatId, session) {
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(
    () => {
      if (sessions.has(chatId)) {
        const namePrefix = session.data.name
          ? `${session.data.name}, вы`
          : "Вы";
        bot
          .sendMessage(
            chatId,
            `${namePrefix} не завершили оформление заказа в «mimi kids 13» 🧸\n` +
              `Нам осталось буквально пара шагов! Ответьте на предыдущий вопрос, чтобы мы могли собрать ваш заказ.`,
          )
          .catch(() => {});
      }
    },
    15 * 60 * 1000,
  ); // 15 минут
}

// ================= СТАРТ ОФОРМЛЕНИЯ ЗАКАЗА =================
function startOrderFlow(chatId, username) {
  const existing = sessions.get(chatId);
  if (existing && existing.timer) clearTimeout(existing.timer);

  const session = {
    step: "WAIT_ITEMS",
    data: { username: username ? `@${username}` : "Скрыт" },
    timer: null,
  };
  sessions.set(chatId, session);
  resetInactivityTimer(chatId, session);

  bot.sendMessage(
    chatId,
    `Шаг 1 из 5. Напишите одним сообщением, что именно вы хотите заказать:\n\n` +
      `1️⃣ Название вещи или модели (например: костюм с мишкой, бежевый)\n` +
      `2️⃣ Рост/размер и возраст ребёнка (например: рост 98 см, 3 года)\n` +
      `3️⃣ Количество (например: 1 шт.)\n\n` +
      `✍️ Напишите эти данные в ответном сообщении:`,
    { reply_markup: { remove_keyboard: true } },
  );
}

// ================= ФИНАЛ И ОТПРАВКА АДМИНУ =================
async function finalizeOrder(chatId, session) {
  if (session.timer) clearTimeout(session.timer);
  sessions.delete(chatId);

  const datetime = new Date().toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
  });
  const orderId = `MK-${Date.now().toString().slice(-6)}`;
  const isDelivery = session.data.deliveryMethod === "Доставка";

  // 1. Резюме клиенту
  const clientSummary = isDelivery
    ? `🎉 ${session.data.name}, ваш заказ в «mimi kids 13» успешно оформлен и принят в обработку!\n\n` +
      `📋 РЕЗЮМЕ ВАШЕГО ЗАКАЗА:\n` +
      `• Заказ (модель, размер/возраст, кол-во): ${session.data.items}\n` +
      `• Получатель: ${session.data.name} (${session.data.phone})\n` +
      `• Способ получения: 🚚 Доставка\n` +
      `• Куда доставить: ${session.data.address}\n` +
      `• Когда: передадим в доставку в ближайший рабочий слот (отправка ежедневно до 18:00)\n` +
      `• Комментарий: ${session.data.comment}\n\n` +
      `Итог: Заявка №${orderId} сформирована и передана на сборку. Спасибо, что выбираете «mimi kids 13»! 💛`
    : `🎉 ${session.data.name}, ваш заказ в «mimi kids 13» успешно оформлен и принят в обработку!\n\n` +
      `📋 РЕЗЮМЕ ВАШЕГО ЗАКАЗА:\n` +
      `• Заказ (модель, размер/возраст, кол-во): ${session.data.items}\n` +
      `• Получатель: ${session.data.name} (${session.data.phone})\n` +
      `• Способ получения: 🏬 Самовывоз\n` +
      `• Откуда забрать: ${CONFIG.PICKUP_ADDRESS}\n` +
      `• Когда можно забрать: заказ будет собран и отложен для вас в течение 2 часов (в рабочее время магазина)\n` +
      `• Комментарий: ${session.data.comment}\n\n` +
      `Итог: Заявка №${orderId} сформирована и передана на сборку. Ждём вас в «mimi kids 13»! 💛`;

  await bot.sendMessage(chatId, clientSummary, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✏️ Изменить данные / Новый заказ",
            callback_data: "START_ORDER",
          },
        ],
      ],
    },
  });

  // 2. Сохранение в резервный файл CSV
  saveOrderToCSV({ orderId, datetime, ...session.data });

  // 3. Отправка структурированной заявки в личку администратору
  const adminMessage =
    `🚨 НОВЫЙ ЗАКАЗ — mimi kids 13\n` +
    `📅 Дата и время: ${datetime}\n` +
    `🆔 Заявка №: ${orderId}\n\n` +
    `👤 КЛИЕНТ:\n` +
    `• Имя: ${session.data.name}\n` +
    `• Телефон: ${session.data.phone}\n` +
    `• Профиль TG: ${session.data.username} (ID: ${chatId})\n\n` +
    `🛍 ЧТО ЗАКАЗАЛИ (товар, размер, возраст, кол-во):\n` +
    `${session.data.items}\n\n` +
    `📦 ПОЛУЧЕНИЕ:\n` +
    `• Способ: ${session.data.deliveryMethod}\n` +
    `• Адрес / Точка: ${session.data.address}\n\n` +
    `💬 КОММЕНТАРИЙ:\n` +
    `${session.data.comment}`;

  try {
    await bot.sendMessage(CONFIG.ADMIN_CHAT_ID, adminMessage, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Принято в работу", callback_data: `ACK_${orderId}` }],
        ],
      },
    });
  } catch (err) {
    console.error(
      `[ОШИБКА ОТПРАВКИ АДМИНУ] Заказ ${orderId} сохранен в orders_backup.csv. Причина:`,
      err.message,
    );
  }
}

// ================= ОБРАБОТКА ВХОДЯЩИХ СООБЩЕНИЙ =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  // Команда для получения своего ID администратора
  if (text === "/my_id") {
    return bot.sendMessage(
      chatId,
      `Ваш Telegram ID для строчки ADMIN_CHAT_ID:\n\`${chatId}\``,
      {
        parse_mode: "Markdown",
      },
    );
  }

  // Приветствие по команде /start
  if (text === "/start" || text.toLowerCase() === "заказ") {
    return bot.sendMessage(
      chatId,
      `Приветствуем в магазине детской одежды «mimi kids 13»! 🧸✨\n\n` +
        `Здесь вы можете оформить заказ за 1 минуту в автоматическом режиме — без ожидания ответа менеджера.\n\n` +
        `Нажмите кнопку ниже, чтобы начать оформление 👇`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🛍 Оформить заказ", callback_data: "START_ORDER" }],
          ],
        },
      },
    );
  }

  const session = sessions.get(chatId);
  if (!session) {
    return bot.sendMessage(
      chatId,
      "Нажмите кнопку ниже, чтобы начать оформление заказа 👇",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🛍 Оформить заказ", callback_data: "START_ORDER" }],
          ],
        },
      },
    );
  }

  resetInactivityTimer(chatId, session);

  switch (session.step) {
    case "WAIT_ITEMS":
      if (!text || text.length < 5) {
        return bot.sendMessage(
          chatId,
          "Пожалуйста, опишите заказ текстом чуть подробнее (укажите модель, размер/возраст ребёнка и количество, минимум 5 символов), чтобы мы собрали посылку без ошибок 🙏",
        );
      }
      session.data.items = text;
      session.step = "WAIT_NAME";
      return bot.sendMessage(
        chatId,
        "Отличный выбор! 👍\n\nШаг 2 из 5. Как к вам можно обращаться? Напишите ваше имя:",
      );

    case "WAIT_NAME":
      if (!REGEX.NAME.test(text)) {
        return bot.sendMessage(
          chatId,
          "Пожалуйста, напишите ваше имя буквами (без цифр и лишних символов), например: Анна.",
        );
      }
      session.data.name = text;
      session.step = "WAIT_PHONE";
      return bot.sendMessage(
        chatId,
        `Приятно познакомиться, ${text}! 😊\n\n` +
          `Шаг 3 из 5. Укажите ваш контактный номер телефона (в формате +7 999 000-00-00) или нажмите кнопку «📱 Отправить мой номер» внизу экрана:`,
        {
          reply_markup: {
            keyboard: [
              [{ text: "📱 Отправить мой номер", request_contact: true }],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        },
      );

    case "WAIT_PHONE":
      // Поддержка как ручного ввода, так и кнопки "Поделиться контактом"
      const phoneInput = msg.contact ? msg.contact.phone_number : text;
      if (!msg.contact && !REGEX.PHONE.test(phoneInput)) {
        return bot.sendMessage(
          chatId,
          "Кажется, в номере закралась опечатка 🤔\nПожалуйста, введите корректный номер телефона из 11 цифр, начиная с +7 или 8 (например: +79991234567):",
        );
      }
      session.data.phone = phoneInput;
      session.step = "WAIT_DELIVERY_METHOD";

      await bot.sendMessage(chatId, "Номер принят! 👌", {
        reply_markup: { remove_keyboard: true },
      });
      return bot.sendMessage(
        chatId,
        `Шаг 4 из 5. Выберите удобный способ получения заказа:\n\n` +
          `🚚 Доставка — отправим заказ по вашему адресу.\n` +
          `🏬 Самовывоз — заберёте самостоятельно из нашего магазина (${CONFIG.PICKUP_ADDRESS}).\n\n` +
          `Нажмите на одну из кнопок ниже 👇`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚚 Доставка", callback_data: "METHOD_DELIVERY" }],
              [{ text: "🏬 Самовывоз", callback_data: "METHOD_PICKUP" }],
            ],
          },
        },
      );

    case "WAIT_DELIVERY_METHOD":
      return bot.sendMessage(
        chatId,
        "Пожалуйста, выберите способ получения, нажав на одну из кнопок под сообщением: «🚚 Доставка» или «🏬 Самовывоз» 👇",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚚 Доставка", callback_data: "METHOD_DELIVERY" }],
              [{ text: "🏬 Самовывоз", callback_data: "METHOD_PICKUP" }],
            ],
          },
        },
      );

    case "WAIT_ADDRESS":
      if (!REGEX.ADDRESS.test(text)) {
        return bot.sendMessage(
          chatId,
          "Адрес выглядит неполным 📦\nПожалуйста, укажите город, улицу и обязательно номер дома/квартиры (минимум 10 символов), чтобы курьер или служба доставки нашли вас без проблем:",
        );
      }
      session.data.address = text;
      session.step = "WAIT_COMMENT";
      return bot.sendMessage(
        chatId,
        "Шаг 5 из 5. Хотите добавить комментарий к заказу? (например: пожелания по времени, код домофона или уточнение по меркам ребёнка).\n\nНапишите ваш комментарий ниже или нажмите кнопку «Пропустить» 👇",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "⏭ Пропустить", callback_data: "SKIP_COMMENT" }],
            ],
          },
        },
      );

    case "WAIT_COMMENT":
      session.data.comment = text || "Без комментария";
      return finalizeOrder(chatId, session);
  }
});

// ================= ОБРАБОТКА НАЖАТИЙ НА КНОПКИ =================
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const username = query.from.username;

  await bot.answerCallbackQuery(query.id).catch(() => {});

  // Кнопка подтверждения заявки у администратора
  if (data.startsWith("ACK_")) {
    const orderId = data.replace("ACK_", "");
    return bot
      .editMessageReplyMarkup(
        {
          inline_keyboard: [
            [
              {
                text: `✅ Принят в работу (${orderId})`,
                callback_data: "NONE",
              },
            ],
          ],
        },
        { chat_id: chatId, message_id: query.message.message_id },
      )
      .catch(() => {});
  }

  if (data === "START_ORDER") {
    return startOrderFlow(chatId, username);
  }

  const session = sessions.get(chatId);
  if (!session) return;

  resetInactivityTimer(chatId, session);

  if (session.step === "WAIT_DELIVERY_METHOD") {
    if (data === "METHOD_DELIVERY") {
      session.data.deliveryMethod = "Доставка";
      session.step = "WAIT_ADDRESS";
      return bot.sendMessage(
        chatId,
        "Шаг 4.1. Напишите полный адрес доставки (город, улица, номер дома, квартира и индекс при необходимости):",
      );
    }

    if (data === "METHOD_PICKUP") {
      session.data.deliveryMethod = "Самовывоз";
      session.data.address = CONFIG.PICKUP_ADDRESS;
      session.step = "WAIT_COMMENT";
      return bot.sendMessage(
        chatId,
        "Шаг 5 из 5. Хотите добавить комментарий к заказу? (например: пожелания по времени или уточнение по меркам ребёнка).\n\nНапишите ваш комментарий ниже или нажмите кнопку «Пропустить» 👇",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "⏭ Пропустить", callback_data: "SKIP_COMMENT" }],
            ],
          },
        },
      );
    }
  }

  if (session.step === "WAIT_COMMENT" && data === "SKIP_COMMENT") {
    session.data.comment = "Без комментария";
    return finalizeOrder(chatId, session);
  }
});

console.log("✅ Telegram-бот «mimi kids 13» успешно запущен и ждёт заказов!");
const http = require('http');
http.createServer((req, res) => res.end('Bot is running')).listen(process.env.PORT || 3000);
