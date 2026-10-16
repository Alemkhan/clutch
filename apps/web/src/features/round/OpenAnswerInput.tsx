import { useEffect, useRef, useState } from 'react';

interface OpenAnswerInputProps {
  onSubmit: (answer: string) => void;
  disabled: boolean;
}

export function OpenAnswerInput({ onSubmit, disabled }: OpenAnswerInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let frameId: number | null = null;
    const revealInput = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = null;
        inputRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    };
    inputRef.current?.focus({ preventScroll: true });
    revealInput();
    window.visualViewport?.addEventListener('resize', revealInput);

    return () => {
      window.visualViewport?.removeEventListener('resize', revealInput);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, []);

  const handleSubmit = () => {
    if (!value.trim() || disabled) return;
    onSubmit(value);
  };

  return (
    <div className="open-answer">
      <input
        ref={inputRef}
        type="text"
        className="open-answer-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => inputRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
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
