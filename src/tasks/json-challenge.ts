import fs from "fs/promises";
import path from "path";
import { OpenAIService } from "../services/OpenAIService";
import axios from "axios";

interface TestItem {
  question: string;
  answer: any;
  test?: {
    q: string;
    a: string;
  };
}

interface JsonData {
  description: string;
  copyright: string;
  "test-data": TestItem[];
  apikey: string;
}

export async function runJsonChallenge() {
  try {
    // Load and parse JSON file
    const jsonPath = path.join(__dirname, "../resources/JSON.json");
    const jsonContent = await fs.readFile(jsonPath, "utf-8");
    const data: JsonData = JSON.parse(jsonContent);

    // Split into two arrays based on 'test' field
    const { withTest, withoutTest } = data["test-data"].reduce<{
      withTest: TestItem[];
      withoutTest: TestItem[];
    }>(
      (acc, item) => {
        if (item.test) {
          acc.withTest.push(item);
        } else {
          acc.withoutTest.push(item);
        }
        return acc;
      },
      { withTest: [], withoutTest: [] }
    );

    // Process ALL items for mathematical expressions
    const correctedWithoutTest = withoutTest.map((item) => ({
      ...item,
      answer: evaluateExpression(item.question),
    }));

    // Process test items - evaluate math AND get LLM answers
    const openAI = new OpenAIService();
    const questions = withTest.map((item) => item.test!.q);
    const answers = await openAI.getAnswers(questions);

    const correctedWithTest = withTest.map((item, index) => ({
      ...item,
      answer: evaluateExpression(item.question),
      test: {
        ...item.test!,
        a: answers[index],
      },
    }));

    // Combine arrays and prepare final payload
    const finalPayload = {
      task: "JSON",
      apikey: process.env.API_KEY,
      answer: {
        ...data,
        apikey: process.env.API_KEY,
        "test-data": [...correctedWithoutTest, ...correctedWithTest],
      },
    };

    // Send to API
    const response = await axios.post(
      "https://centrala.ag3nts.org/report",
      finalPayload
    );
    console.log("Verification response:", response.data);
  } catch (error) {
    console.error("Error:", error);
  }
}

function evaluateExpression(expression: string): number {
  try {
    // Using Function constructor to safely evaluate mathematical expressions
    return new Function(`return ${expression}`)();
  } catch {
    return NaN;
  }
}
