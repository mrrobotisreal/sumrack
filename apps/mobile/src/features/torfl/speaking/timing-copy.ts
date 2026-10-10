import { minutesRu } from '../minutes-ru';

/**
 * Every task-3 timing string, generated from the windows in play (T76, A2-9):
 * the exam speaking screen, the instruction facts, «Билеты» and the tickets
 * screen all read these, so a level's numbers live in ONE place (the item /
 * the level profile) and never in copy.
 */

/** «8 минут на подготовку, затем 2 минуты на ответ». */
export function windowsLine(prepSec: number, answerSec: number): string {
  return `${minutesRu(prepSec)} на подготовку, затем ${minutesRu(answerSec)} на ответ`;
}

/** The choose-step lead: «Задание 3. Выбери одну из двух тем. После выбора — …». Only for a group of two. */
export function chooseLine(topicCount: number, prepSec: number, answerSec: number): string {
  const lead =
    topicCount === 2 ? 'Выбери одну из двух тем. После выбора — ' : 'Выбери тему. После выбора — ';
  return `Задание 3. ${lead}${windowsLine(prepSec, answerSec)}.`;
}

/** The instruction-screen fact: two topics → «одна тема из двух», one → «одна тема». */
export function task3Fact(topicCount: number, prepSec: number, answerSec: number): string {
  const topics =
    topicCount === 2
      ? 'одна тема из двух'
      : topicCount === 1
        ? 'одна тема'
        : `одна из ${topicCount} тем`;
  const mins = (s: number) => `${Math.round(s / 60)} мин`;
  return `Задание 3: ${topics}, подготовка ${mins(prepSec)}, ответ ${mins(answerSec)}.`;
}

/** The recording-start confirm body: «Запись пойдёт сразу: 5 минут, без остановки таймера.» */
export function startAnswerLine(answerSec: number): string {
  return `Запись пойдёт сразу: ${minutesRu(answerSec)}, без остановки таймера.`;
}

/** The answering caption: «Идёт запись — 5 минут». */
export function recordingLine(answerSec: number): string {
  return `Идёт запись — ${minutesRu(answerSec)}`;
}

/** The prep-card hint: «Расскажи 12–15 предложений. …» */
export function sentencesLine(min: number, max: number): string {
  return `Расскажи ${min}–${max} предложений. Отвечать нужно без текста — заметки только для подготовки.`;
}
