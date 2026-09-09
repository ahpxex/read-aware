const en = {
  "title": "Reading time",
  "allBooks": "All books",
  "active": "Active reading",
  "settled": "Settled",
  "pending": "Pending sessions",
  "sampledAt": "Sampled at (UTC)",
  "day": "Calendar day",
  "empty": "No pending sessions",
  "refresh": "Refresh",
  "next": "Next page",
  "lastActivity": "Last activity (UTC)",
  "positionAt": "Position observed (UTC)",
  "noPosition": "No position",
  "lastSuccessful": "Last successful sample",
  "allTime": "All time",
  "today": "Today"
};
type Copy = typeof en;
const copies: Record<string, Copy> = {
  en,
  "zh-Hans": {"title":"阅读时长","allBooks":"全部书籍","active":"有效阅读","settled":"已结算","pending":"待结算会话","sampledAt":"采样时间（UTC）","day":"日期","empty":"没有待结算会话","refresh":"刷新","next":"下一页","lastActivity":"最近活动（UTC）","positionAt":"位置观测（UTC）","noPosition":"无位置","lastSuccessful":"上次成功的采样","allTime":"全部时间","today":"今天"},
  "zh-Hant": {"title":"閱讀時間","allBooks":"全部書籍","active":"有效閱讀","settled":"已結算","pending":"待結算工作階段","sampledAt":"取樣時間（UTC）","day":"日期","empty":"沒有待結算工作階段","refresh":"重新整理","next":"下一頁","lastActivity":"最近活動（UTC）","positionAt":"位置觀測（UTC）","noPosition":"無位置","lastSuccessful":"上次成功的取樣","allTime":"全部時間","today":"今天"},
  "ja": {"title":"読書時間","allBooks":"すべての本","active":"実読書時間","settled":"確定済み","pending":"未確定セッション","sampledAt":"取得時刻（UTC）","day":"日付","empty":"未確定セッションなし","refresh":"更新","next":"次のページ","lastActivity":"最終活動（UTC）","positionAt":"位置の観測（UTC）","noPosition":"位置なし","lastSuccessful":"最後に取得した値","allTime":"全期間","today":"今日"},
  "de": {"title":"Lesezeit","allBooks":"Alle Bücher","active":"Aktive Lesezeit","settled":"Abgeschlossen","pending":"Offene Sitzungen","sampledAt":"Erfasst (UTC)","day":"Kalendertag","empty":"Keine offenen Sitzungen","refresh":"Aktualisieren","next":"Nächste Seite","lastActivity":"Letzte Aktivität (UTC)","positionAt":"Position erfasst (UTC)","noPosition":"Keine Position","lastSuccessful":"Letzte erfolgreiche Messung","allTime":"Gesamter Zeitraum","today":"Heute"},
  "fr": {"title":"Temps de lecture","allBooks":"Tous les livres","active":"Lecture active","settled":"Consolidé","pending":"Sessions en attente","sampledAt":"Relevé (UTC)","day":"Jour","empty":"Aucune session en attente","refresh":"Actualiser","next":"Page suivante","lastActivity":"Dernière activité (UTC)","positionAt":"Position observée (UTC)","noPosition":"Aucune position","lastSuccessful":"Dernier relevé réussi","allTime":"Toute la période","today":"Aujourd’hui"},
  "es": {"title":"Tiempo de lectura","allBooks":"Todos los libros","active":"Lectura activa","settled":"Consolidado","pending":"Sesiones pendientes","sampledAt":"Muestra (UTC)","day":"Día","empty":"Sin sesiones pendientes","refresh":"Actualizar","next":"Página siguiente","lastActivity":"Última actividad (UTC)","positionAt":"Posición observada (UTC)","noPosition":"Sin posición","lastSuccessful":"Última muestra válida","allTime":"Todo el tiempo","today":"Hoy"},
  "ru": {"title":"Время чтения","allBooks":"Все книги","active":"Активное чтение","settled":"Учтено","pending":"Открытые сеансы","sampledAt":"Замер (UTC)","day":"День","empty":"Нет открытых сеансов","refresh":"Обновить","next":"Следующая страница","lastActivity":"Активность (UTC)","positionAt":"Позиция (UTC)","noPosition":"Нет позиции","lastSuccessful":"Последний успешный замер","allTime":"Всё время","today":"Сегодня"},
};
export function timeCopy(locale: string): Copy { return copies[locale] ?? copies[locale.split("-")[0]] ?? en; }
