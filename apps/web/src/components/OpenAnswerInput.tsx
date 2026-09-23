import { useState, useRef } from 'react';

interface OpenAnswerInputProps {
  onSubmit: (answer: string, timeMs: number) => void;
  disabled: boolean;
}

export function OpenAnswerInput({ onSubmit, disabled }: OpenAnswerInputProps) {
  const [value, setValue] = useState('');
  const startTimeRef = useRef(Date.now());

  const handleSubmit = () => {
    if (!value.trim() || disabled) return;
    const elapsed = Date.now() - startTimeRef.current;
    onSubmit(value, elapsed);
  };

  return (
    <div className="open-answer">
      <input
        type="text"
        className="open-answer-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        placeholder="Напиши ответ..."
        autoFocus
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <button
        className="open-answer-submit"
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
      >
        Отправить
      </button>
    </div>
  );
}
