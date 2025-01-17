import { ReadStream } from "fs";
import dotenv from "dotenv";
import { OpenAI } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat";
import * as fs from "fs/promises";
import { createReadStream } from "fs";
import axios from "axios";
import path from "path";

dotenv.config();

interface AnalyzeConfig {
  fileType: "text" | "image" | "audio";
  content?: string;
  filePath?: string;
}

interface AnalysisResult {
  people: boolean;
  hardware: boolean;
}

interface ContentChunk {
  title: string;
  text: string;
  image?: string;
  audio?: string;
  analysis?: string;
  audioTranscription?: string;
}

async function downloadFile(url: string): Promise<Buffer> {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
  });
  return Buffer.from(new Uint8Array(response.data));
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
      model: "gpt-4o",
      messages,
      temperature: 0.7,
    });

    return completion.choices[0].message.content || "";
  }

  async getAnswers(
    questions: string[],
    options?: {
      context?: string;
      customPrompt?: string;
      formatAsObject?: boolean;
      questionIds?: string[];
    }
  ): Promise<string> {
    const defaultPrompt = `Please answer these questions concisely and accurately:
${questions
  .map((q, i) => `${options?.questionIds?.[i] || i + 1}. ${q}`)
  .join("\n")}`;

    const contextPrompt = options?.context
      ? `Based on this context:\n\n${options.context}\n\n`
      : "";
    const prompt =
      options?.customPrompt ||
      `${contextPrompt}${defaultPrompt}${
        options?.formatAsObject
          ? "\n\nFormat your response as a JSON object where keys are question IDs and values are one-sentence answers."
          : ""
      }`;

    const response = await this.openai.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-4",
      temperature: 0,
    });

    return response.choices[0].message.content || "{}";
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

  async analyzeContent(config: AnalyzeConfig): Promise<string> {
    console.log(`Analyzing ${config.fileType} content...`);

    let contentToAnalyze: string = "";

    switch (config.fileType) {
      case "text":
        if (!config.content)
          throw new Error("Content required for text analysis");
        contentToAnalyze = config.content;
        break;

      case "image":
        if (!config.filePath)
          throw new Error("File path required for image analysis");

        let imageBase64: string;

        // Download image if it's a URL
        if (config.filePath.startsWith("http")) {
          const imageBuffer = await downloadFile(config.filePath);
          imageBase64 = imageBuffer.toString("base64");
        } else {
          imageBase64 = (await fs.readFile(config.filePath)).toString("base64");
        }

        const imageContent = {
          type: "image_url" as const,
          image_url: {
            url: `data:image/png;base64,${imageBase64}`,
          },
        };
        return (
          (
            await this.openai.chat.completions.create({
              model: "gpt-4o",
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: "Describe what you see in this image concisely.",
                    },
                    imageContent,
                  ],
                },
              ],
              max_tokens: 100,
            })
          ).choices[0].message.content || ""
        );

      case "audio":
        if (!config.filePath)
          throw new Error("File path required for audio analysis");

        // Download audio file if it's a URL
        if (config.filePath.startsWith("http")) {
          const audioBuffer = await downloadFile(config.filePath);
          const tempPath = path.join(__dirname, `../../temp/${Date.now()}.mp3`);
          await fs.mkdir(path.dirname(tempPath), { recursive: true }); // Create temp dir if it doesn't exist
          await fs.writeFile(tempPath, audioBuffer);
          const readStream = createReadStream(tempPath);
          contentToAnalyze = await this.transcribeAudio(readStream);
          await fs.unlink(tempPath); // Cleanup
        } else {
          const audioStream = createReadStream(config.filePath);
          contentToAnalyze = await this.transcribeAudio(audioStream);
        }
        break;
    }

    return contentToAnalyze;
  }

  async analyzeForCategories(config: AnalyzeConfig): Promise<AnalysisResult> {
    const content = await this.analyzeContent(config);

    const response = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: `${getCategoryAnalysisPrompt(
            config.fileType
          )}\n\nContent to analyze:\n${content}`,
        },
      ],
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

  async processWebContent(chunks: ContentChunk[]): Promise<ContentChunk[]> {
    for (const chunk of chunks) {
      try {
        // Process image if present
        if (chunk.image) {
          const imageBuffer = await downloadFile(chunk.image);
          const imageContent = {
            type: "image_url" as const,
            image_url: {
              url: `data:image/png;base64,${imageBuffer.toString("base64")}`,
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
                    text: `Analyze this image and its caption thoroughly, with special attention to local references:

1. First, analyze the caption word by word, looking for:
   - Local nicknames or colloquial names
   - References to landmarks or buildings
   - Directional information (like "od strony", "przy", "obok")
   - Any specific viewpoints or perspectives mentioned

2. Then describe what you see in the image in detail

3. Try to identify the exact location by:
   - Cross-referencing any mentioned nicknames with their actual locations
   - Looking for well-known buildings or landmarks
   - Using directional clues from the caption
   - Considering historical context of the area

4. For any colloquial names or nicknames found:
   - What is their official or full name?
   - What is their significance in the local area?
   - How do they help identify the location?

Context and caption: ${chunk.text}

Provide a detailed analysis that connects all these pieces of information to identify the specific location.`,
                  },
                  imageContent,
                ],
              },
            ],
            max_tokens: 500, // Increased token limit for more detailed analysis
          });
          chunk.analysis = imageResponse.choices[0].message.content || "";
        }

        // Process audio if present
        if (chunk.audio) {
          const audioBuffer = await downloadFile(chunk.audio);
          const tempPath = `/tmp/${Date.now()}.mp3`;
          await fs.writeFile(tempPath, audioBuffer);

          const readStream = createReadStream(tempPath);
          chunk.audioTranscription = await this.transcribeAudio(readStream);
          await fs.unlink(tempPath); // Cleanup
        }

        // Process text content
        if (chunk.text) {
          const textResponse = await this.openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              {
                role: "user",
                content: `Summarize this text concisely: ${chunk.text}
                         ${
                           chunk.audioTranscription
                             ? `\nIncluding this transcription: ${chunk.audioTranscription}`
                             : ""
                         }`,
              },
            ],
          });
          chunk.text = textResponse.choices[0].message.content || chunk.text;
        }
      } catch (error) {
        console.error(`Error processing chunk "${chunk.title}":`, error);
        // Keep original content on error
      }
    }

    return chunks;
  }

  async generateMarkdown(chunks: ContentChunk[]): Promise<string> {
    return chunks
      .map((chunk) => {
        let md = `## ${chunk.title}\n\n`;

        if (chunk.image) {
          md += `![${chunk.title}](${chunk.image})\n\n`;
          if (chunk.analysis) {
            md += `**Image Analysis:** ${chunk.analysis}\n\n`;
          }
        }

        if (chunk.audio) {
          md += `🔊 [Audio file](${chunk.audio})\n\n`;
          if (chunk.audioTranscription) {
            md += `**Audio Transcription:** ${chunk.audioTranscription}\n\n`;
          }
        }

        md += `${chunk.text}\n\n`;

        return md;
      })
      .join("---\n\n");
  }

  async getAnswersFromContext(
    context: string,
    questions: string
  ): Promise<string> {
    const prompt = `Based on this context:

${context}

Answer these questions concisely (one sentence each):

${questions}

Format your response as a JSON object where keys are question IDs and values are one-sentence answers.
If there are N questions, format your response as a JSON object with N keys and N values.
Example format:
{
    "01": "krótka odpowiedź",
    "02": "krótka odpowiedź"
}`;

    const response = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });

    return response.choices[0].message.content || "{}";
  }

  async summarizeContent(content: string, type: string): Promise<string> {
    const prompt = `Summarize the following ${type} content, preserving all important facts, names, places, and key details. Be concise but don't omit crucial information:

${content}`;

    const response = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    return response.choices[0].message.content || content;
  }

  async createEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
        encoding_format: "float",
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error("Error creating embedding:", error);
      throw error;
    }
  }

  async createEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: texts,
        encoding_format: "float",
      });

      return response.data.map((item) => item.embedding);
    } catch (error) {
      console.error("Error creating embeddings:", error);
      throw error;
    }
  }
}
