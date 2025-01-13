import { ReadStream } from "fs";
import { OpenAI } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat";

export class OpenAIService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async transcribeAudio(readStream: ReadStream): Promise<string> {
    const transcription = await this.openai.audio.transcriptions.create({
      file: readStream,
      model: "whisper-1",
      language: "pl",
    });
    return transcription.text;
  }

  async analyzeTranscriptions(context: string): Promise<string> {
    const prompt = `
      Based on the following transcriptions from Polish audio recordings about Andrzej Maj:

      ${context}

      Using this context and your knowledge, determine the name of the street where the school that Andrzej Maj teaches is located.

      Important instructions:
      1. The street name will not be directly mentioned in the transcriptions
      2. Use contextual clues and your knowledge about schools in the area
      3. If multiple possible answers exist, explain your reasoning for choosing one
      4. If you cannot determine the street name with high confidence, explain why
      5. Feel free to think step by step and share your reasoning process
      6. Consider any indirect references, landmarks, or geographical hints in the transcriptions
      7. You can explore multiple possibilities before arriving at your final answer

      Take your time to analyze. Share your thought process in Polish, then provide your final answer.`;

    return this.getAnswer(prompt);
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
