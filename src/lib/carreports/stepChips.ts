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
      "Начнём с автомобиля. Продиктуйте VIN (или скажите, что нечитаемый), пробег, госномер, город осмотра, и при необходимости ссылку на объявление. Дату осмотра можно выбрать справа.",
    needsDate: true,
    chips: [
      { label: "VIN нечитаемый", value: "VIN нечитаемый." },
      { label: "Пробег соответствует", value: "Пробег визуально соответствует состоянию." },
      { label: "Пробег НЕ соответствует", value: "Пробег визуально НЕ соответствует состоянию." },
    ],
  },
  characteristics: {
    greeting:
      "Теперь характеристики. Я подтянул данные по VIN — поправьте, если что-то не так, или продиктуйте свои значения.",
    chips: [
      { label: "Бензин", value: "Двигатель: Бензин.", group: "fuel", single: true },
      { label: "Дизель", value: "Двигатель: Дизель.", group: "fuel", single: true },
      { label: "Гибрид", value: "Двигатель: Гибрид.", group: "fuel", single: true },
      { label: "Электро", value: "Двигатель: Электро.", group: "fuel", single: true },
      { label: "Газ/Бензин", value: "Двигатель: Газ/Бензин.", group: "fuel", single: true },
      { label: "АКПП", value: "КПП: АКПП.", group: "tx", single: true },
      { label: "МКПП", value: "КПП: МКПП.", group: "tx", single: true },
      { label: "Робот", value: "КПП: Робот.", group: "tx", single: true },
      { label: "Вариатор", value: "КПП: Вариатор.", group: "tx", single: true },
      { label: "Передний привод", value: "Привод: Передний.", group: "drv", single: true },
      { label: "Задний привод", value: "Привод: Задний.", group: "drv", single: true },
      { label: "Полный привод", value: "Привод: Полный.", group: "drv", single: true },
    ],
  },
  docs: {
    greeting:
      "Сверим документы. Сколько владельцев по ПТС? Совпадает ли собственник, VIN на кузове и номер двигателя?",
    chips: [
      { label: "1 владелец", value: "Владельцев по ПТС: 1.", group: "owners", single: true },
      { label: "2 владельца", value: "Владельцев по ПТС: 2.", group: "owners", single: true },
      { label: "3 владельца", value: "Владельцев по ПТС: 3.", group: "owners", single: true },
      { label: "4+ владельцев", value: "Владельцев по ПТС: 4 и более.", group: "owners", single: true },
      { label: "Собственник совпадает", value: "Собственник совпадает с ПТС/СТС." },
      { label: "Собственник НЕ совпадает", value: "Собственник НЕ совпадает с ПТС/СТС." },
      { label: "VIN на кузове совпадает", value: "VIN на кузове совпадает с документами." },
      { label: "VIN на кузове НЕ совпадает", value: "VIN на кузове НЕ совпадает с документами." },
      { label: "№ двигателя совпадает", value: "Номер двигателя совпадает с ПТС." },
      { label: "№ двигателя НЕ совпадает", value: "Номер двигателя НЕ совпадает с ПТС." },
    ],
  },
  inspection: {
    greeting: "Перейдём к осмотру по зонам. (доступно на следующем этапе сборки)",
    chips: [],
  },
  testDrive: { greeting: "Тест-драйв — следующий этап сборки.", chips: [] },
  result: { greeting: "Итог — следующий этап сборки.", chips: [] },
  submit: { greeting: "Отправка — следующий этап сборки.", chips: [] },
};
