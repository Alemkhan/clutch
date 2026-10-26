import { describe, expect, it } from "vitest";
import {
  calculatorReducer,
  calculatorValue,
  initialCalculatorState,
  type CalculatorAction,
} from "./tiebreakerCalculator";

function press(...actions: CalculatorAction[]) {
  return actions.reduce(calculatorReducer, initialCalculatorState);
}

describe("На глазок calculator", () => {
  it("calculates chained basic operations in sequence", () => {
    const state = press(
      { type: "digit", value: "8" },
      { type: "operator", value: "÷" },
      { type: "digit", value: "2" },
      { type: "operator", value: "+" },
      { type: "digit", value: "1" },
      { type: "equals" },
    );
    expect(calculatorValue(state)).toBe(5);
    expect(state.operator).toBeNull();
  });

  it("keeps decimal arithmetic exact across chained operations", () => {
    const sum = press(
      { type: "digit", value: "0" }, { type: "decimal" }, { type: "digit", value: "1" },
      { type: "operator", value: "+" },
      { type: "digit", value: "0" }, { type: "decimal" }, { type: "digit", value: "2" },
      { type: "equals" },
    );
    expect(sum.display).toBe("0,3");
    expect(calculatorValue(sum)).toBe(0.3);

    const chain = [
      { type: "operator", value: "×" }, { type: "digit", value: "3" }, { type: "operator", value: "+" },
      { type: "digit", value: "0" }, { type: "decimal" }, { type: "digit", value: "1" }, { type: "equals" },
    ] as CalculatorAction[];
    const result = chain.reduce(calculatorReducer, sum);
    expect(result.display).toBe("1");
    expect(calculatorValue(result)).toBe(1);
  });

  it("limits calculated display to twelve significant digits", () => {
    const result = press(
      { type: "digit", value: "1" }, { type: "operator", value: "÷" },
      { type: "digit", value: "3" }, { type: "equals" },
    );
    expect(result.display).toBe("0,333333333333");
    expect(result.display).toMatch(/^0,[0-9]{12}$/);
  });

  it("supports decimal comma and deleting the last digit", () => {
    const state = press(
      { type: "digit", value: "1" },
      { type: "decimal" },
      { type: "digit", value: "5" },
      { type: "backspace" },
    );
    expect(state.display).toBe("1,");
    expect(calculatorValue(state)).toBe(1);
  });

  it("reports division by zero and lets the user continue with a new number", () => {
    const error = press(
      { type: "digit", value: "4" },
      { type: "operator", value: "÷" },
      { type: "digit", value: "0" },
      { type: "equals" },
    );
    expect(error.error).toBe("На ноль делить нельзя");
    expect(calculatorReducer(error, { type: "digit", value: "7" }).display).toBe("7");
  });

  it("clears the whole calculation", () => {
    const result = calculatorReducer(
      press({ type: "digit", value: "9" }, { type: "operator", value: "×" }),
      { type: "clear" },
    );
    expect(result).toEqual(initialCalculatorState);
  });
});
