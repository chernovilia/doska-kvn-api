// Настройки, которые админ меняет в «Настройках» (Setting): тип, границы, значение по умолчанию.
// app.* — ещё и публичные: отдаются сайту в GET /site (когда показывать окна приложения).
export const MANAGED_SETTINGS: Record<
  string,
  { label: string; hint: string; type: 'bool' | 'number'; default: string; min: number; max: number; step?: number }
> = {
  // ── Приложение: когда показывать окно установки и предложение уведомлений ──
  'app.install.enabled': {
    label: 'Окно установки: показывать само',
    hint: 'Выключено — только из Настроек профиля («Установить приложение»)',
    type: 'bool', default: 'true', min: 0, max: 1
  },
  'app.install.after_publish': {
    label: 'Окно установки после публикации',
    hint: 'После каждого нового объявления (опубликовано или на проверке)',
    type: 'bool', default: 'true', min: 0, max: 1
  },
  'app.install.every_nth_visit': {
    label: 'Окно установки: каждый N-й заход',
    hint: '2 — на 2-й, 4-й, 6-й… заход; 1 — каждый заход; 0 — не показывать на заходах',
    type: 'number', default: '2', min: 0, max: 20, step: 1
  },
  'app.install.visit_gap_min': {
    label: 'Новый заход — после перерыва, минут',
    hint: 'Сколько минут без активности считать окончанием захода',
    type: 'number', default: '30', min: 5, max: 1440, step: 5
  },
  'app.install.delay_sec': {
    label: 'Окно установки: задержка, секунд',
    hint: 'Через сколько секунд после начала захода показать',
    type: 'number', default: '8', min: 0, max: 120, step: 1
  },
  'app.install.dismiss_days': {
    label: 'Пауза после «Не показывать», дней',
    hint: 'Сколько дней не показывать окно и баннер установки сами (из Настроек — всегда). 365 — почти навсегда',
    type: 'number', default: '14', min: 0, max: 365, step: 1
  },
  'app.banner.enabled': {
    label: 'Баннер «Установите приложение» вверху страниц',
    hint: 'Узкая полоса с кнопкой «Установить»; крестик прячет её на срок паузы',
    type: 'bool', default: 'true', min: 0, max: 1
  },
  'app.push.after_message': {
    label: 'Предлагать уведомления после первого сообщения',
    hint: 'На iPhone в браузере вместо этого — окно установки',
    type: 'bool', default: 'true', min: 0, max: 1
  },
  'app.push.after_publish': {
    label: 'Предлагать уведомления после публикации',
    hint: 'Когда окно установки не показывается (уже установлено или пауза)',
    type: 'bool', default: 'true', min: 0, max: 1
  },
  'app.push.on_app_open': {
    label: 'Предлагать уведомления при открытии приложения',
    hint: 'Установленное приложение, человек вошёл, уведомления выключены — спрашиваем через пару секунд',
    type: 'bool', default: 'true', min: 0, max: 1
  },
  'app.push.ask_every_days': {
    label: 'Предлагать уведомления не чаще, дней',
    hint: 'Пауза после «Не сейчас». Просто закрыли окно — спросим в следующий заход',
    type: 'number', default: '14', min: 1, max: 90, step: 1
  },
  'moderation.autoApprove': {
    label: 'Автопубликация',
    hint: 'Выключено — новые объявления ждут одобрения в админке',
    type: 'bool', default: 'true', min: 0, max: 1
  },
  'ads.lifetime_days': {
    label: 'Срок показа объявления, дней',
    hint: 'Потом — в архив; автор может продлить',
    type: 'number', default: '60', min: 7, max: 365, step: 1
  },
  'ads.archive_keep_days': {
    label: 'Хранить архив, дней',
    hint: 'Потом объявление удаляется вместе с фото',
    type: 'number', default: '90', min: 7, max: 365, step: 1
  },
  'ads.rejected_keep_days': {
    label: 'Хранить отклонённые, дней',
    hint: 'Потом удаляются вместе с фото',
    type: 'number', default: '30', min: 3, max: 365, step: 1
  },
  'ads.lifecycle_warn_days': {
    label: 'Предупреждать за, дней',
    hint: 'Письмо автору перед архивом и перед удалением',
    type: 'number', default: '3', min: 0, max: 14, step: 1
  },
  'reviews.min_messages': {
    label: 'Отзыв: сообщений от каждого',
    hint: 'Сколько сообщений должен написать каждый в переписке, чтобы оценить друг друга',
    type: 'number', default: '4', min: 1, max: 30, step: 1
  },
  'reviews.min_hours': {
    label: 'Отзыв: часов с начала переписки',
    hint: 'Не раньше этого времени после первого сообщения',
    type: 'number', default: '1', min: 0, max: 72, step: 1
  },
  'ranking.auto_bump_enabled': {
    label: 'Автоподнятие доступно',
    hint: 'Автор может включить: объявление поднимается само, когда наступает срок подъёма',
    type: 'bool', default: 'true', min: 0, max: 1
  },
  'ranking.bump_cooldown_days': {
    label: 'Поднять можно через, дней',
    hint: 'После публикации или прошлого подъёма',
    type: 'number', default: '10', min: 1, max: 90, step: 1
  },
  'ranking.boost_bonus': {
    label: 'Бонус новым и поднятым',
    hint: 'Прибавка к рейтингу на 24 часа; 0.15 ≈ сразу в топ',
    type: 'number', default: '0.15', min: 0, max: 1, step: 0.05
  },
  'ranking.freshness_days': {
    label: 'Свежесть, дней',
    hint: 'За сколько дней объявление «стареет» до нуля',
    type: 'number', default: '10', min: 1, max: 90, step: 1
  },
  'ranking.weight.freshness': { label: 'Вес: свежесть', hint: '', type: 'number', default: '0.35', min: 0, max: 1, step: 0.05 },
  'ranking.weight.quality': { label: 'Вес: качество (фото, описание)', hint: '', type: 'number', default: '0.10', min: 0, max: 1, step: 0.05 },
  'ranking.weight.trust': { label: 'Вес: доверие к автору', hint: 'Рейтинг и проверка', type: 'number', default: '0.15', min: 0, max: 1, step: 0.05 },
  'ranking.weight.engagement': { label: 'Вес: интерес (просмотры)', hint: '', type: 'number', default: '0.10', min: 0, max: 1, step: 0.05 },
  'ranking.same_author_max_top10': {
    label: 'Макс. объявлений одного автора в топ-10',
    hint: 'Чтобы один продавец не занял всю ленту',
    type: 'number', default: '3', min: 1, max: 10, step: 1
  }
};
