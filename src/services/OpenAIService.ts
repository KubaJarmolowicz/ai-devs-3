import { OpenAI } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat";

export class OpenAIService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async getAnswer(
    question: string,
    systemInstruction?: string
  ): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [
      ...(systemInstruction
        ? [{ role: "system" as const, content: systemInstruction }]
        : []),
      { role: "user" as const, content: question },
    ];

    const completion = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.7,
    });

    return completion.choices[0].message.content || "";
  }

  async getAnswers(questions: string[]): Promise<string[]> {
    const prompt = `Please answer these questions concisely and accurately:
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Provide answers in a simple array format, one answer per line.`;

    const response = await this.openai.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-3.5-turbo",
    });

    return response.choices[0].message
      .content!.split("\n")
      .filter((line) => line.trim())
      .map((line) => line.replace(/^\d+\.\s*/, "").trim());
  }
}
