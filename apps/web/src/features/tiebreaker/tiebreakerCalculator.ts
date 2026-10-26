import Big from "big.js";

export type CalculatorOperator = "+" | "−" | "×" | "÷";

export interface CalculatorState {
  display: string;
  accumulator: string | null;
  operator: CalculatorOperator | null;
  replaceDisplay: boolean;
  error: string | null;
}

export const initialCalculatorState: CalculatorState = {
  display: "0",
  accumulator: null,
  operator: null,
  replaceDisplay: false,
  error: null,
};

export type CalculatorAction =
  | { type: "digit"; value: string }
  | { type: "decimal" }
  | { type: "operator"; value: CalculatorOperator }
  | { type: "equals" }
  | { type: "clear" }
  | { type: "backspace" };

function calculate(left: Big, right: Big, operator: CalculatorOperator): Big {
  switch (operator) {
    case "+": return left.plus(right);
    case "−": return left.minus(right);
    case "×": return left.times(right);
    case "÷": return left.div(right);
  }
}

function displayNumber(value: Big): string {
  return new Big(value.toPrecision(12)).toString().replace(".", ",");
}

function currentNumber(display: string): Big {
  return new Big(display.replace(",", "."));
}

function finiteNumber(value: Big): boolean {
  return Number.isFinite(Number(value.toString()));
}

export function calculatorReducer(state: CalculatorState, action: CalculatorAction): CalculatorState {
  if (action.type === "clear") return initialCalculatorState;
  if (action.type === "digit") {
    const display = state.replaceDisplay || state.error
      ? action.value
      : state.display === "0" ? action.value : `${state.display}${action.value}`;
    if (display.replace(/[,.]/g, "").length > 16) return state;
    return { ...state, display, replaceDisplay: false, error: null };
  }
  if (action.type === "decimal") {
    if (state.replaceDisplay || state.error) {
      return { ...state, display: "0,", replaceDisplay: false, error: null };
    }
    if (state.display.includes(",") || state.display.includes(".")) return state;
    return { ...state, display: `${state.display},`, error: null };
  }
  if (action.type === "backspace") {
    if (state.replaceDisplay || state.error) return { ...state, display: "0", replaceDisplay: false, error: null };
    const display = state.display.slice(0, -1);
    return { ...state, display: !display || display === "-" ? "0" : display, error: null };
  }

  const current = currentNumber(state.display);
  if (action.type === "operator") {
    if (state.operator && state.accumulator !== null && !state.replaceDisplay) {
      const accumulator = new Big(state.accumulator);
      if (state.operator === "÷" && current.eq(0)) {
        return { ...initialCalculatorState, error: "На ноль делить нельзя" };
      }
      const result = calculate(accumulator, current, state.operator);
      if (!finiteNumber(result)) return { ...initialCalculatorState, error: "Слишком большое число" };
      const resultText = result.toString();
      return { display: displayNumber(result), accumulator: resultText, operator: action.value, replaceDisplay: true, error: null };
    }
    return { ...state, accumulator: current.toString(), operator: action.value, replaceDisplay: true, error: null };
  }

  if (!state.operator || state.accumulator === null) return state;
  if (state.operator === "÷" && current.eq(0)) {
    return { ...initialCalculatorState, error: "На ноль делить нельзя" };
  }
  const result = calculate(new Big(state.accumulator), current, state.operator);
  if (!finiteNumber(result)) return { ...initialCalculatorState, error: "Слишком большое число" };
  return { ...initialCalculatorState, display: displayNumber(result), replaceDisplay: true };
}

export function calculatorValue(state: CalculatorState): number | null {
  const value = Number(state.display.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}
