// Built-in cliches/chips for each step — shown inline inside the assistant
// message. Tap = inserted into the composer; "single" groups replace each
// other so the inspector can't pick e.g. two fuel types.

import type { ChatChip, StepId } from "./types";

interface StepIntro {
  greeting: string;
  chips: ChatChip[];
  /** chips that need a date picker etc. handled separately in UI */
  needsDate?: boolean;
}

export const STEP_INTROS: Record<StepId, StepIntro> = {
  car: {
    greeting:
      "Здравствуйте! Я помогу собрать паспорт автомобиля — это первый шаг отчёта. Расскажите всё, что знаете: VIN или госномер, пробег, город и дата осмотра, ссылку на объявление, а также марку, модель, год и техчасть. Можно надиктовать голосом, прикрепить фото СТС/ПТС или нажать на подсказки ниже — я подставлю готовые формулировки.",
    needsDate: true,
    chips: [
      { label: "VIN нечитаемый", value: "VIN нечитаемый.", groupLabel: "Идентификация" },
      { label: "Пробег соответствует", value: "Пробег визуально соответствует состоянию.", groupLabel: "Идентификация" },
      { label: "Пробег НЕ соответствует", value: "Пробег визуально НЕ соответствует состоянию.", groupLabel: "Идентификация" },
      { label: "Бензин", value: "Двигатель: Бензин.", group: "fuel", single: true, groupLabel: "Двигатель" },
      { label: "Дизель", value: "Двигатель: Дизель.", group: "fuel", single: true, groupLabel: "Двигатель" },
      { label: "Гибрид", value: "Двигатель: Гибрид.", group: "fuel", single: true, groupLabel: "Двигатель" },
      { label: "Электро", value: "Двигатель: Электро.", group: "fuel", single: true, groupLabel: "Двигатель" },
      { label: "Газ/Бензин", value: "Двигатель: Газ/Бензин.", group: "fuel", single: true, groupLabel: "Двигатель" },
      { label: "АКПП", value: "КПП: АКПП.", group: "tx", single: true, groupLabel: "Коробка передач" },
      { label: "МКПП", value: "КПП: МКПП.", group: "tx", single: true, groupLabel: "Коробка передач" },
      { label: "Робот", value: "КПП: Робот.", group: "tx", single: true, groupLabel: "Коробка передач" },
      { label: "Вариатор", value: "КПП: Вариатор.", group: "tx", single: true, groupLabel: "Коробка передач" },
      { label: "Передний", value: "Привод: Передний.", group: "drv", single: true, groupLabel: "Привод" },
      { label: "Задний", value: "Привод: Задний.", group: "drv", single: true, groupLabel: "Привод" },
      { label: "Полный", value: "Привод: Полный.", group: "drv", single: true, groupLabel: "Привод" },
    ],
  },

  characteristics: {
    greeting: "",
    chips: [],
  },
  docs: {
    greeting:
      "Сверим документы. Сколько владельцев по ПТС? Совпадает ли собственник, VIN на кузове и номер двигателя?",
    chips: [
      { label: "1 владелец", value: "Владельцев по ПТС: 1.", group: "owners", single: true, groupLabel: "Владельцы по ПТС" },
      { label: "2 владельца", value: "Владельцев по ПТС: 2.", group: "owners", single: true, groupLabel: "Владельцы по ПТС" },
      { label: "3 владельца", value: "Владельцев по ПТС: 3.", group: "owners", single: true, groupLabel: "Владельцы по ПТС" },
      { label: "4+ владельцев", value: "Владельцев по ПТС: 4 и более.", group: "owners", single: true, groupLabel: "Владельцы по ПТС" },
      { label: "Совпадает", value: "Собственник совпадает с ПТС/СТС.", group: "owner_match", single: true, groupLabel: "Собственник = продавец" },
      { label: "НЕ совпадает", value: "Собственник НЕ совпадает с ПТС/СТС.", group: "owner_match", single: true, groupLabel: "Собственник = продавец" },
      { label: "Совпадает", value: "VIN на кузове совпадает с документами.", group: "vin_match", single: true, groupLabel: "VIN на кузове = ПТС/СТС" },
      { label: "НЕ совпадает", value: "VIN на кузове НЕ совпадает с документами.", group: "vin_match", single: true, groupLabel: "VIN на кузове = ПТС/СТС" },
      { label: "Совпадает", value: "Номер двигателя совпадает с ПТС.", group: "engine_match", single: true, groupLabel: "№ двигателя = ПТС" },
      { label: "НЕ совпадает", value: "Номер двигателя НЕ совпадает с ПТС.", group: "engine_match", single: true, groupLabel: "№ двигателя = ПТС" },
    ],
  },
  inspection: {
    greeting:
      "Перейдём к осмотру. Выберите зону кнопкой ниже — появятся типовые клише. Можете надиктовать своё, прикрепить фото, и нажать стрелку, чтобы зафиксировать заметку для зоны. Когда все зоны пройдены — «Всё верно, далее».",
    chips: [],
  },
  testDrive: {
    greeting:
      "Тест-драйв: как ведёт себя авто в движении? Опишите разгон, торможение, рулевое, посторонние шумы. Если тест-драйв не проводился — выберите «Не проводился».",
    chips: [
      { label: "Не проводился", value: "Тест-драйв не проводился.", group: "td", single: true },
      { label: "Проводился", value: "Тест-драйв проведён.", group: "td", single: true },
      { label: "Разгон ровный", value: "Разгон ровный, без рывков." },
      { label: "Рывки при переключении", value: "Рывки при переключении передач." },
      { label: "Тормозит ровно", value: "Тормозит ровно, без увода." },
      { label: "Уводит при торможении", value: "Уводит в сторону при торможении." },
      { label: "Руль без люфта", value: "Рулевое управление без люфта." },
      { label: "Посторонние шумы", value: "Посторонние шумы в подвеске/трансмиссии." },
    ],
  },
  result: {
    greeting:
      "Итог по осмотру. Сформулируйте краткое резюме по состоянию авто и вашу рекомендацию покупателю. Можно надиктовать своими словами, чипсы помогут с типовыми формулировками.",
    chips: [
      { label: "Рекомендую к покупке", value: "Рекомендую автомобиль к покупке.", group: "verdict", single: true },
      { label: "С торгом", value: "Рекомендую к покупке с торгом по выявленным дефектам.", group: "verdict", single: true },
      { label: "Не рекомендую", value: "Не рекомендую к покупке.", group: "verdict", single: true },
      { label: "Авто в среднем состоянии", value: "Состояние автомобиля — среднее для своего возраста и пробега." },
      { label: "Авто в хорошем состоянии", value: "Состояние автомобиля — хорошее." },
      { label: "Требует вложений", value: "Автомобиль требует вложений в ближайшее время." },
    ],
  },
  submit: {
    greeting:
      "Финал. Проверьте сводку отчёта в правой панели. Когда всё корректно — нажмите «Отправить отчёт». Я сохраню черновик и попытаюсь отправить его на сервер carreports.",
    chips: [],
  },
};
