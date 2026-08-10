import { describe, expect, it } from "vitest";
import {
  defaultTodoEmoji,
  presentTodo,
  todoPriorityFromText,
} from "../src/todo-presentation.js";

describe("to-do presentation", () => {
  it("keeps an explicit low priority out of the title and gives a fitting emoji", () => {
    expect(presentTodo({
      source: "Add buy a melon with low priority to my todo list",
      title: "Buy a melon with low priority",
    })).toEqual({
      title: "Buy a melon 🍈",
      priority: "low",
      emoji: "🍈",
    });
  });

  it("preserves the AI's concise title, priority, and one supplied emoji", () => {
    expect(presentTodo({
      source: "Please urgently call the dentist",
      title: "Call the dentist",
      priority: "high",
      emoji: "📞",
    })).toEqual({
      title: "Call the dentist 📞",
      priority: "high",
      emoji: "📞",
    });
  });

  it("has deterministic fallbacks when the AI is unavailable", () => {
    expect(todoPriorityFromText("Buy a watermelon, not urgent")).toBe("low");
    expect(defaultTodoEmoji("Buy a watermelon")).toBe("🍉");
    expect(presentTodo({ source: "Buy a watermelon", title: "Buy a watermelon" }).title).toBe("Buy a watermelon 🍉");
  });
});
