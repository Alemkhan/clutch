import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Question } from '@clutch/shared';
import { QuestionScreen } from './QuestionScreen';

const question: Question = {
  id: 'question-1', type: 'multiple_choice', answerType: 'multiple_choice',
  category: 'geography', difficulty: 'Easy', prompt: 'Какой это флаг?',
  options: [{ id: 'a', text: 'Казахстан' }, { id: 'b', text: 'Кыргызстан' }],
  correctOptionId: 'a', explanation: 'Тестовый вопрос.', status: 'approved',
  createdAt: '2026-10-01',
};

describe('QuestionScreen readiness', () => {
  it('renders a question without media as immediately answerable', () => {
    const html = renderToStaticMarkup(<QuestionScreen question={question} onAnswer={vi.fn()} />);
    expect(html).toContain(question.prompt);
    expect(html).toContain('Казахстан');
    expect(html).toContain('timer-ring');
    expect(html).not.toContain('Загружаем изображение');
  });

  it('keeps prompt, answers and timer hidden while required media is pending', () => {
    const html = renderToStaticMarkup(
      <QuestionScreen
        question={{ ...question, mediaType: 'flag', mediaUrl: 'https://example.com/flag.png' }}
        onAnswer={vi.fn()}
      />,
    );
    expect(html).toContain('Загружаем изображение вопроса');
    expect(html).toContain('loading="eager"');
    expect(html).not.toContain(question.prompt);
    expect(html).not.toContain('Казахстан');
    expect(html).not.toContain('timer-ring');
  });

  it('renders artwork media with its artwork styling and descriptive alt text', () => {
    const html = renderToStaticMarkup(
      <QuestionScreen
        question={{ ...question, mediaType: 'image', mediaUrl: 'https://example.com/artwork.jpg' }}
        onAnswer={vi.fn()}
      />,
    );

    expect(html).toContain('question-media-slot pending artwork');
    expect(html).toContain('class="question-media artwork"');
    expect(html).toContain('alt="Иллюстрация к вопросу"');
    expect(html).toContain('src="https://example.com/artwork.jpg"');
  });
});
