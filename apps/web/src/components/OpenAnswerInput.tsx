import { useState } from 'react';

interface OpenAnswerInputProps {
  onSubmit: (answer: string) => void;
  disabled: boolean;
}

export function OpenAnswerInput({ onSubmit, disabled }: OpenAnswerInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = () => {
    if (!value.trim() || disabled) return;
    onSubmit(value);
  };

  return (
    <div className="open-answer">
      <input
        type="text"
        className="open-answer-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          handleSubmit();
        }}
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
