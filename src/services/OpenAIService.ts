import { ReadStream } from "fs";
import { OpenAI } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat";
import * as fs from "fs/promises";
import { createReadStream } from "fs";

interface AnalyzeConfig {
  fileType: "text" | "image" | "audio";
  content?: string;
  filePath?: string;
}

interface AnalysisResult {
  people: boolean;
  hardware: boolean;
}

const getCategoryAnalysisPrompt = (
  contentType: string
) => `Analyze this ${contentType} and determine if it contains:
1. Information about people being found / captured.
2. Information/data about hardware repairs. Pay close attention to the meaning of the text, not just the keywords present.
Improvements and software fixes ARE NOT hardware repairs.

Respond in this exact format:
{"people": boolean, "hardware": boolean}
IMPORTANT: ONLY RESPOND WITH THE JSON, NO OTHER TEXT.

Note:
- For "people": only mark true if there's info about captured individuals or clear evidence of their recent activities
- For "hardware": only mark true if there's specific info about hardware fixes / repairs`;

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

  async analyzeImages(imagePaths: string[]): Promise<string> {
    const imageContents = await Promise.all(
      imagePaths.map(async (path) => ({
        type: "image_url" as const,
        image_url: {
          url: `data:image/png;base64,${(
            await fs.readFile(path)
          ).toString("base64")}`,
        },
      }))
    );

    const prompt = `Analyze these maps carefully. Three of them show the same city.

    Your task:
    1. Focus on identifying the city that appears in three maps
    2. First, look at what is actually shown on these three matching maps - what streetnames, buildings, named landmarks, intersections do you see?
    3. Write down all the cities that match the criteria.
    4. Then, verify one by one if any of these cities contains "spichlerze" (granaries) and "twierdze" (fortresses).
    5. Name the city and explain why you believe it's the correct one based on what you see in the map.

    Think step by step and explain your reasoning, focusing on the visual evidence first.`;

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...imageContents],
        },
      ],
      max_tokens: 1000,
    });

    return response.choices[0].message.content || "";
  }

  async generateImage(description: string): Promise<string> {
    const response = await this.openai.images.generate({
      model: "dall-e-3",
      prompt: description,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "url",
    });

    if (!response.data[0].url) throw new Error("No image URL received");
    return response.data[0].url;
  }

  async cleanRobotDescription(description: string): Promise<string> {
    const prompt = `Extract and rewrite ONLY the physical description of the robot from this text, preserving the original language and style. Include only details relevant for creating a visual image:

${description}`;

    const response = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    return response.choices[0].message.content || description;
  }

  async analyzeForCategories(config: AnalyzeConfig): Promise<AnalysisResult> {
    console.log(`Analyzing ${config.fileType} content...`);

    let contentToAnalyze: string = "";

    // Handle different content types
    switch (config.fileType) {
      case "text":
        if (!config.content)
          throw new Error("Content required for text analysis");
        contentToAnalyze = config.content;
        break;

      case "image":
        if (!config.filePath)
          throw new Error("File path required for image analysis");
        const imageContent = {
          type: "image_url" as const,
          image_url: {
            url: `data:image/png;base64,${(
              await fs.readFile(config.filePath)
            ).toString("base64")}`,
          },
        };

        const imageResponse = await this.openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: getCategoryAnalysisPrompt("image"),
                },
                imageContent,
              ],
            },
          ],
          max_tokens: 100,
        });

        try {
          return JSON.parse(
            imageResponse.choices[0].message.content ||
              '{"people": false, "hardware": false}'
          );
        } catch (e) {
          console.error(
            "Failed to parse GPT vision response:",
            imageResponse.choices[0].message.content
          );
          return { people: false, hardware: false };
        }

      case "audio":
        if (!config.filePath)
          throw new Error("File path required for audio analysis");
        const audioStream = createReadStream(config.filePath);
        contentToAnalyze = await this.transcribeAudio(audioStream);
        break;
    }

    // For text and transcribed audio, analyze the content
    if (config.fileType === "text" || config.fileType === "audio") {
      const prompt = `${getCategoryAnalysisPrompt("content")}

Content to analyze:
${contentToAnalyze}`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      });

      try {
        return JSON.parse(
          response.choices[0].message.content ||
            '{"people": false, "hardware": false}'
        );
      } catch (e) {
        console.error(
          "Failed to parse GPT response:",
          response.choices[0].message.content
        );
        return { people: false, hardware: false };
      }
    }

    throw new Error("Unsupported file type");
  }
}
